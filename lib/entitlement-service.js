// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SERVER AUTHORIZATION & ENTITLEMENT CONTROL PLANE
// Idempotent payment claim approvals, addon expiry rules, and admin control center backend
// ============================================================================

const { db } = require('../database');
const { AddonService } = require('./addon-service');

class EntitlementService {
  /**
   * Computes Effective Entitlements for an Organization:
   * Base Plan Entitlements + Active Add-on Entitlements
   */
  static async getOrganizationEntitlements(organizationId) {
    let tier = 'FREE';
    if (organizationId) {
      const orgRow = await db.get('SELECT tier, status FROM organizations WHERE id = ?', [organizationId]);
      if (orgRow && orgRow.tier) {
        tier = orgRow.tier.toUpperCase();
      }
    }

    // 1. Base Plan Entitlements
    const baseEnt = await db.get('SELECT * FROM plan_entitlements WHERE tier = ?', [tier]) || {
      tier: 'FREE',
      max_branches: 1,
      max_terminals: 1,
      max_products: 25,
      features_json: '{"csv_import": true, "analytics": "basic"}'
    };

    let baseFeatures = {};
    try { baseFeatures = JSON.parse(baseEnt.features_json || '{}'); } catch (_) {}

    let effective = {
      tier: baseEnt.tier,
      maxBranches: baseEnt.max_branches,
      maxTerminals: baseEnt.max_terminals,
      maxProducts: baseEnt.max_products,
      features: { ...baseFeatures },
      activeAddons: []
    };

    // 2. Active Add-on Entitlements with Expiry Check
    const addonRows = await db.all(
      `SELECT * FROM local_preferences WHERE key LIKE ?`,
      [`addon_active_${organizationId}_%`]
    );

    for (const r of addonRows) {
      const addonId = r.key.replace(`addon_active_${organizationId}_`, '');
      const isActive = await AddonService.isAddonActive(organizationId, addonId);

      if (isActive) {
        const addon = AddonService.getAddonById(addonId);
        if (addon) {
          effective.activeAddons.push(addon.id);
          (addon.entitlementKeys || []).forEach(k => {
            effective.features[k] = true;
          });
        }
      }
    }

    return effective;
  }

  /**
   * Transactional & Idempotent Payment Claims Approval:
   * Re-approving an already approved claim returns existing result without double activation
   */
  static async approvePaymentClaim(claimId, approvedBy = 'ADMIN') {
    await db.beginImmediate();
    try {
      const claimRow = await db.get(`SELECT * FROM local_preferences WHERE key = ?`, [`payment_claim_${claimId}`]);
      if (!claimRow) throw new Error('Payment claim not found');

      const claim = JSON.parse(claimRow.value_payload);

      // IDEMPOTENCY CHECK: If already APPROVED or ACTIVE -> return cleanly
      if (claim.status === 'APPROVED' || claim.status === 'ACTIVE') {
        await db.commit();
        return { success: true, claim, alreadyApproved: true, message: 'Payment claim was already approved.' };
      }

      claim.status = 'APPROVED';
      claim.approvedAt = Date.now();
      claim.approvedBy = approvedBy;

      // Update claim status
      await db.run(`UPDATE local_preferences SET value_payload = ? WHERE key = ?`, [
        JSON.stringify(claim),
        `payment_claim_${claimId}`
      ]);

      // Calculate expiry timestamp (Monthly addons = +30 days, One-time = Perpetual)
      const addon = AddonService.getAddonById(claim.addonId);
      const isMonthly = addon && addon.billingPeriod === 'MONTHLY';
      const expiresAt = isMonthly ? Date.now() + 30 * 24 * 60 * 60 * 1000 : null;

      const activeRecord = {
        status: 'ACTIVE',
        addonId: claim.addonId,
        organizationId: claim.organizationId,
        activatedAt: Date.now(),
        activatedBy: approvedBy,
        paymentRef: claim.paymentRef,
        expiresAt
      };

      // Activate Add-on
      await db.run(
        `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [`addon_active_${claim.organizationId}_${claim.addonId}`, JSON.stringify(activeRecord)]
      );

      // Audit Record
      const auditId = `AUDIT_ADDON_${Date.now()}`;
      await db.run(
        `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [
          `audit_addon_${auditId}`,
          JSON.stringify({
            id: auditId,
            action: 'ACTIVATE_ADDON',
            organizationId: claim.organizationId,
            addonId: claim.addonId,
            paymentRef: claim.paymentRef,
            performedBy: approvedBy,
            timestamp: Date.now()
          })
        ]
      );

      await db.commit();
      return { success: true, claim, alreadyApproved: false };
    } catch (err) {
      await db.rollback();
      throw err;
    }
  }

  /**
   * Payment Claims Administrative Submission
   */
  static async submitPaymentClaim(accountId, organizationId, addonId, amountMinor, paymentRef, notes = '') {
    const claimId = `CLAIM_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const payload = {
      id: claimId,
      accountId,
      organizationId,
      addonId,
      amountMinor,
      paymentRef,
      notes,
      status: 'PENDING',
      submittedAt: Date.now()
    };

    await db.run(
      `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
      [`payment_claim_${claimId}`, JSON.stringify(payload)]
    );

    return payload;
  }

  /**
   * Organization Search by ID, Email, Name, Phone, or Terminal/Device ID
   */
  static async searchOrganizations(queryStr) {
    const q = `%${queryStr.trim()}%`;
    const orgs = await db.all(
      `SELECT DISTINCT o.* 
       FROM organizations o
       LEFT JOIN organization_members om ON om.organization_id = o.id
       LEFT JOIN accounts a ON a.id = om.account_id
       LEFT JOIN approved_devices d ON d.organization_id = o.id
       WHERE o.id LIKE ? OR o.name LIKE ? OR a.email LIKE ? OR a.phone LIKE ? OR d.node_id LIKE ?`,
      [q, q, q, q, q]
    );

    return orgs;
  }

  /**
   * Transactional Activation of Plan & Add-ons
   */
  static async activateSubscription(organizationId, newTier, paymentRef, activatedBy = 'ADMIN') {
    await db.beginImmediate();
    try {
      await db.run('UPDATE organizations SET tier = ?, updated_at = ? WHERE id = ?', [newTier, Date.now(), organizationId]);

      const subId = `SUB_${Date.now()}`;
      await db.run(
        `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [
          `sub_event_${subId}`,
          JSON.stringify({
            id: subId,
            organizationId,
            newTier,
            paymentRef,
            activatedBy,
            timestamp: Date.now()
          })
        ]
      );

      await db.commit();
      await this.evaluateGraceLock(organizationId);

      return { success: true, tier: newTier, organizationId };
    } catch (err) {
      await db.rollback();
      throw err;
    }
  }

  static async canCreateProduct(organizationId) {
    const ent = await this.getOrganizationEntitlements(organizationId);
    if (ent.maxProducts === Infinity || ent.maxProducts >= 2147483647) {
      return { allowed: true, current: 0, limit: Infinity };
    }

    const countRow = await db.get(
      'SELECT COUNT(*) as cnt FROM inventory_catalog WHERE organization_id = ? AND is_deleted = 0',
      [organizationId]
    );
    const current = countRow ? countRow.cnt : 0;

    if (current >= ent.maxProducts) {
      return {
        allowed: false,
        reason: `Product limit reached for ${ent.tier} tier (${current}/${ent.maxProducts}). Upgrade plan for unlimited catalog items.`,
        current,
        limit: ent.maxProducts
      };
    }
    return { allowed: true, current, limit: ent.maxProducts };
  }

  static async canAddBranch(organizationId, currentCountOverride) {
    const isObj = typeof organizationId === 'object' && organizationId !== null;
    const ent = isObj ? organizationId : await this.getOrganizationEntitlements(organizationId);
    const allowedLimit = ent.maxBranches || ent.limit || 1;
    let current = 0;

    if (typeof currentCountOverride === 'number') {
      current = currentCountOverride;
    } else if (isObj && typeof organizationId.currentBranches === 'number') {
      current = organizationId.currentBranches;
    } else if (!isObj) {
      const countRow = await db.get(
        'SELECT COUNT(*) as cnt FROM branches WHERE organization_id = ?',
        [organizationId]
      );
      current = countRow ? countRow.cnt : 0;
    }

    if (current >= allowedLimit) {
      return {
        allowed: false,
        reason: `Branch limit reached for ${ent.tier || 'current'} plan (${current}/${allowedLimit}). Purchase an Extra Branch add-on or upgrade plan.`,
        current,
        limit: allowedLimit
      };
    }
    return { allowed: true, current, limit: allowedLimit };
  }

  static async canAddTerminal(organizationId, currentCountOverride) {
    const isObj = typeof organizationId === 'object' && organizationId !== null;
    const ent = isObj ? organizationId : await this.getOrganizationEntitlements(organizationId);
    const allowedLimit = ent.maxTerminals || ent.limit || 1;
    let current = 0;

    if (typeof currentCountOverride === 'number') {
      current = currentCountOverride;
    } else if (isObj && typeof organizationId.currentTerminals === 'number') {
      current = organizationId.currentTerminals;
    } else if (!isObj) {
      const countRow = await db.get(
        'SELECT COUNT(*) as cnt FROM approved_devices WHERE organization_id = ? AND status = "APPROVED"',
        [organizationId]
      );
      current = countRow ? countRow.cnt : 0;
    }

    if (current >= allowedLimit) {
      return {
        allowed: false,
        reason: `Terminal limit reached for ${ent.tier || 'current'} plan (${current}/${allowedLimit}). Purchase an Extra Terminal add-on to register more devices.`,
        current,
        limit: allowedLimit
      };
    }
    return { allowed: true, current, limit: allowedLimit };
  }

  static async canCreateOrganization(accountId, isFreeTierRequested = true) {
    if (!isFreeTierRequested) return { allowed: true };

    const freeOrgCountRow = await db.get(
      `SELECT COUNT(*) as cnt 
       FROM organization_members om
       JOIN organizations o ON o.id = om.organization_id
       WHERE om.account_id = ? AND o.tier = 'FREE' AND om.status = 'active'`,
      [accountId]
    );

    const count = freeOrgCountRow ? freeOrgCountRow.cnt : 0;
    if (count >= 1) {
      return {
        allowed: false,
        reason: 'Account already has an active Free Basic Organization. Please upgrade your account to create additional organizations.'
      };
    }
    return { allowed: true };
  }

  static async evaluateGraceLock(organizationId) {
    const ent = await this.getOrganizationEntitlements(organizationId);
    const activeTerminals = await db.all(
      'SELECT node_id, approved_at FROM approved_devices WHERE organization_id = ? AND status = "APPROVED" ORDER BY approved_at ASC',
      [organizationId]
    );

    if (activeTerminals.length > ent.maxTerminals) {
      const excessCount = activeTerminals.length - ent.maxTerminals;
      const terminalsToLock = activeTerminals.slice(ent.maxTerminals);
      for (const term of terminalsToLock) {
        await db.run('UPDATE approved_devices SET status = "GRACE_LOCKED" WHERE node_id = ?', [term.node_id]);
      }
      return { locked: excessCount };
    }
    return { locked: 0 };
  }
}

module.exports = EntitlementService;
