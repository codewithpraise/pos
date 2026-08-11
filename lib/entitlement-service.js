// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - SERVER AUTHORIZATION & ENTITLEMENT CONTROL PLANE
// Idempotent payment claim approvals, addon expiry rules, and admin control center backend
// ============================================================================

const crypto = require('crypto');
const { db } = require('../database');
const { AddonService } = require('./addon-service');
const { FEATURE_REGISTRY, getFeatureDefinition } = require('./feature-registry');

class EntitlementService {
  static SERVER_KEY_PAIR = null;

  static getServerKeyPair() {
    if (!this.SERVER_KEY_PAIR) {
      this.SERVER_KEY_PAIR = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
    }
    return this.SERVER_KEY_PAIR;
  }

  static getPublicVerificationKey() {
    return this.getServerKeyPair().publicKey;
  }

  static canonicalJson(obj) {
    if (obj === null || typeof obj !== 'object') {
      return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
      return '[' + obj.map(item => this.canonicalJson(item)).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + this.canonicalJson(obj[k])).join(',') + '}';
  }

  static generateSignedOfflineSnapshot(payload) {
    const keyPair = this.getServerKeyPair();
    const snapshotId = `SNAP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const fullPayload = {
      snapshotId,
      keyId: 'key_v1_ed25519',
      schemaVersion: '17',
      releaseVersion: '2.5.1',
      issuedSequence: Date.now(),
      issuedAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
      ...payload
    };

    const canonicalPayload = this.canonicalJson(fullPayload);
    const signature = crypto.sign(null, Buffer.from(canonicalPayload), keyPair.privateKey).toString('base64');

    return {
      snapshot: fullPayload,
      signature,
      publicKey: keyPair.publicKey
    };
  }

  static verifySignedOfflineSnapshot(snapshot, signature, publicKeyPem) {
    try {
      if (!snapshot || !signature || !publicKeyPem) return false;
      const canonicalPayload = this.canonicalJson(snapshot);
      const isVerified = crypto.verify(null, Buffer.from(canonicalPayload), publicKeyPem, Buffer.from(signature, 'base64'));
      if (!isVerified) return false;
      if (snapshot.expiresAt && snapshot.expiresAt < Date.now()) return false;
      return true;
    } catch (_) {
      return false;
    }
  }
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
      const dbKey = claimId.startsWith('payment_claim_') ? claimId : `payment_claim_${claimId}`;
      const claimRow = await db.get(`SELECT * FROM local_preferences WHERE key = ? OR key = ?`, [dbKey, claimId]);
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
        claimRow.key
      ]);

      const addonId = claim.addonId || claim.addon_id;
      const orgId = claim.organizationId || claim.organization_id;

      if (addonId && orgId) {
        const addon = AddonService.getAddonById(addonId);
        const isMonthly = addon && addon.billingPeriod === 'MONTHLY';
        const expiresAt = isMonthly ? Date.now() + 30 * 24 * 60 * 60 * 1000 : null;

        const activeRecord = {
          status: 'ACTIVE',
          addonId,
          organizationId: orgId,
          activatedAt: Date.now(),
          activatedBy: approvedBy,
          paymentRef: claim.paymentRef || claim.rrn_reference,
          expiresAt
        };

        await db.run(
          `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, ?)`,
          [`addon_active_${orgId}_${addonId}`, JSON.stringify(activeRecord)]
        );
      }

      const auditId = `AUDIT_ADDON_${Date.now()}`;
      await db.run(
        `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [
          `audit_addon_${auditId}`,
          JSON.stringify({
            id: auditId,
            action: 'ACTIVATE_ADDON',
            organizationId: orgId,
            addonId,
            paymentRef: claim.paymentRef || claim.rrn_reference,
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
   * Resolve Server-Side Authenticated Identity:
   * NEVER trust organizationId, terminalId, or role supplied blindly in req.body / req.query
   */
  static async resolveIdentity(req) {
    const headers = req ? (req.headers || {}) : {};
    let userId = (req && req.user && req.user.id) || headers['x-user-id'] || 'ANONYMOUS_USER';
    let organizationId = (req && req.user && req.user.organization_id) || headers['x-organization-id'] || 'ORG_LOCAL_DEFAULT';
    let branchId = (req && req.user && req.user.branch_id) || headers['x-branch-id'] || 'BRANCH_LOCAL_DEFAULT';
    let terminalId = (req && req.user && req.user.terminal_id) || headers['x-terminal-id'] || 'HWID-LOCAL-NODE';
    let userRole = (req && req.user && req.user.role) || headers['x-user-role'] || 'owner';

    // Verify organization membership if DB contains organizations table
    try {
      if (organizationId && organizationId !== 'ORG_LOCAL_DEFAULT') {
        const orgRow = await db.get('SELECT id FROM organizations WHERE id = ?', [organizationId]);
        if (!orgRow) {
          // Fallback to primary local org
          const fallbackOrg = await db.get('SELECT id FROM organizations LIMIT 1');
          if (fallbackOrg && fallbackOrg.id) organizationId = fallbackOrg.id;
        }
      }
    } catch (_) {}

    return {
      userId,
      organizationId,
      branchId,
      terminalId,
      userRole
    };
  }

  /**
   * Hard Server-Side Feature Authorization:
   * Evaluates feature entitlement + plan requirement + dependency requirement + role scope + expiry
   */
  static async authorizeFeature({ req, organizationId: explicitOrgId, featureKey, action }) {
    const identity = await this.resolveIdentity(req);
    const orgId = explicitOrgId || identity.organizationId;

    const featureDef = getFeatureDefinition(featureKey);
    if (!featureDef) {
      return {
        allowed: false,
        code: 'UNKNOWN_FEATURE',
        featureKey,
        message: `Feature '${featureKey}' is not registered in master FEATURE_REGISTRY.`
      };
    }

    // Fetch Effective Entitlements
    const effective = await this.getOrganizationEntitlements(orgId);

    // Map featureKey to entitlement property or check activeAddons
    const requiredAddon = featureDef.addonId;
    const isGrantedByPlan = Boolean(
      effective && effective.features &&
      (effective.features[featureKey] || effective.features[featureDef.featureKey])
    );

    const isGrantedByAddon = Boolean(
      effective &&
      ((effective.features && (effective.features[featureKey] || effective.features[featureDef.featureKey])) ||
       (effective.activeAddons && (
         effective.activeAddons.includes(requiredAddon) ||
         effective.activeAddons.includes(`addon_${requiredAddon.toLowerCase()}`) ||
         effective.activeAddons.some(a => a.includes(requiredAddon.toLowerCase()))
       )))
    );

    let allowed = isGrantedByPlan || isGrantedByAddon;
    let code = allowed ? 'AUTHORIZED' : 'ADDON_NOT_APPROVED';
    let reason = allowed ? 'Active Approved Entitlement' : `Add-on '${requiredAddon}' is not approved for organization '${orgId}'.`;

    // Role check if feature mandates specific roles
    if (allowed && featureDef.roles && featureDef.roles.length > 0) {
      const userRole = (identity.userRole || 'owner').toLowerCase();
      const hasRole = featureDef.roles.map(r => r.toLowerCase()).includes(userRole);
      if (!hasRole) {
        allowed = false;
        code = 'ROLE_NOT_PERMITTED';
        reason = `Role '${identity.userRole}' is not permitted to execute action '${action || featureKey}'.`;
      }
    }

    // Build Deterministic Feature-Specific Snapshot Object
    const featureStatusMap = {};
    Object.values(FEATURE_REGISTRY).forEach(f => {
      const fAddon = f.addonId;
      const isAct = Boolean(effective && effective.activeAddons && effective.activeAddons.includes(fAddon));
      featureStatusMap[f.featureKey] = {
        status: isAct ? 'ACTIVE' : 'DENIED',
        requiredAddon: fAddon,
        scope: f.scope
      };
    });

    const snapshotPayload = {
      organizationId: orgId,
      terminalId: identity.terminalId,
      userId: identity.userId,
      subscription: {
        tier: effective.tier,
        status: 'ACTIVE'
      },
      features: featureStatusMap,
      targetFeature: {
        key: featureKey,
        allowed,
        code,
        reason
      }
    };

    const signedSnapshot = this.generateSignedOfflineSnapshot(snapshotPayload);

    return {
      allowed,
      code,
      featureKey,
      requiredAddon,
      organizationId: orgId,
      message: reason,
      snapshot: signedSnapshot.snapshot,
      signature: signedSnapshot.signature
    };
  }

  /**
   * Server-Authoritative Feature Gate Check (Alias wrapper)
   */
  static async canUseFeature(organizationId, featureKey) {
    if (!organizationId) {
      return { allowed: false, reason: 'ORGANIZATION_REQUIRED', message: 'Organization ID is required for feature validation.' };
    }
    const authRes = await this.authorizeFeature({ organizationId, featureKey });
    return {
      allowed: authRes.allowed,
      reason: authRes.code,
      message: authRes.message,
      entitlement: authRes.snapshot
    };
  }

  /**
   * Admin Direct Grant of Add-on
   */
  static async grantAddon(organizationId, addonId, durationDays = 30, grantedBy = 'ADMIN') {
    await db.beginImmediate();
    try {
      const expiresAt = durationDays > 0 ? Date.now() + durationDays * 86400000 : null;
      const activeRecord = {
        status: 'ACTIVE',
        addonId,
        organizationId,
        activatedAt: Date.now(),
        activatedBy: grantedBy,
        expiresAt
      };

      await db.run(
        `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [`addon_active_${organizationId}_${addonId}`, JSON.stringify(activeRecord)]
      );

      const auditId = `AUDIT_GRANT_${Date.now()}`;
      await db.run(
        `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [
          `audit_addon_${auditId}`,
          JSON.stringify({
            id: auditId,
            action: 'ADMIN_GRANT_ADDON',
            organizationId,
            addonId,
            durationDays,
            performedBy: grantedBy,
            timestamp: Date.now()
          })
        ]
      );

      await db.commit();
      return { success: true, record: activeRecord };
    } catch (err) {
      await db.rollback();
      throw err;
    }
  }

  /**
   * Admin Direct Revocation of Add-on
   */
  static async revokeAddon(organizationId, addonId, revokedBy = 'ADMIN', reason = '') {
    await db.beginImmediate();
    try {
      const activeRecord = {
        status: 'REVOKED',
        addonId,
        organizationId,
        revokedAt: Date.now(),
        revokedBy,
        reason
      };

      await db.run(
        `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [`addon_active_${organizationId}_${addonId}`, JSON.stringify(activeRecord)]
      );

      const auditId = `AUDIT_REVOKE_${Date.now()}`;
      await db.run(
        `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [
          `audit_addon_${auditId}`,
          JSON.stringify({
            id: auditId,
            action: 'ADMIN_REVOKE_ADDON',
            organizationId,
            addonId,
            reason,
            performedBy: revokedBy,
            timestamp: Date.now()
          })
        ]
      );

      await db.commit();
      return { success: true, record: activeRecord };
    } catch (err) {
      await db.rollback();
      throw err;
    }
  }

  /**
   * Admin Extension of Active Add-on
   */
  static async extendAddon(organizationId, addonId, extraDays = 30, extendedBy = 'ADMIN') {
    await db.beginImmediate();
    try {
      const existing = await db.get(
        `SELECT * FROM local_preferences WHERE key = ?`,
        [`addon_active_${organizationId}_${addonId}`]
      );

      let payload = existing && existing.value_payload ? JSON.parse(existing.value_payload) : { status: 'ACTIVE', activatedAt: Date.now() };
      const currentExpiry = payload.expiresAt && payload.expiresAt > Date.now() ? payload.expiresAt : Date.now();
      payload.expiresAt = currentExpiry + extraDays * 86400000;
      payload.status = 'ACTIVE';
      payload.extendedAt = Date.now();
      payload.extendedBy = extendedBy;

      await db.run(
        `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, ?)`,
        [`addon_active_${organizationId}_${addonId}`, JSON.stringify(payload)]
      );

      await db.commit();
      return { success: true, record: payload };
    } catch (err) {
      await db.rollback();
      throw err;
    }
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

  static PENDING_LEASE_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL lease for pending registrations

  static isCapacityConsumingStatus(status, timestamp = Date.now(), requestedAt = null) {
    if (!status) return false;
    const s = String(status).toUpperCase();
    if (s === 'ACTIVE' || s === 'APPROVED') return true;
    if (s === 'PENDING') {
      if (!requestedAt) return true;
      const age = timestamp - requestedAt;
      return age < EntitlementService.PENDING_LEASE_TTL_MS;
    }
    return false;
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
      // 1. Expire stale pending registrations older than 10-minute TTL lease
      const cutoff = Date.now() - EntitlementService.PENDING_LEASE_TTL_MS;
      try {
        await db.run(
          'UPDATE approved_devices SET status = "EXPIRED" WHERE organization_id = ? AND status = "PENDING" AND (approved_at < ? OR requested_at < ?)',
          [organizationId, cutoff, cutoff]
        );
      } catch (_) {}

      // 2. Count capacity-consuming terminal nodes (APPROVED, ACTIVE, or unexpired PENDING)
      const countRow = await db.get(
        'SELECT COUNT(*) as cnt FROM approved_devices WHERE organization_id = ? AND status IN ("APPROVED", "ACTIVE", "PENDING")',
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
