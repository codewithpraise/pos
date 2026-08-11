// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - ADDON REQUEST MANAGEMENT SERVICE
// Manages activation request lifecycle for operationally complex add-ons
// ============================================================================

const { db } = require('../database');
const { AddonService } = require('./addon-service');

const ADDON_REQUEST_STATUSES = {
  REQUESTED: 'REQUESTED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  ACTION_REQUIRED: 'ACTION_REQUIRED',
  APPROVED: 'APPROVED',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED'
};

class AddonRequestService {
  /**
   * Creates a formal add-on request record for an Organization / Branch
   */
  static async createRequest(accountId, organizationId, addonId, branchId = null, notes = '') {
    const addon = AddonService.getAddonById(addonId);
    if (!addon) {
      throw new Error(`Invalid add-on identifier '${addonId}'.`);
    }

    const requestId = `REQ_ADDON_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();

    await db.run(
      `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
      [
        `addon_req_${requestId}`,
        JSON.stringify({
          id: requestId,
          accountId,
          organizationId,
          addonId,
          addonName: addon.name,
          branchId,
          priceMinor: addon.priceMinor,
          billingInterval: addon.billingInterval,
          requestedAt: now,
          status: ADDON_REQUEST_STATUSES.REQUESTED,
          notes,
          nextSteps: addon.setupGuide || ['Awaiting confirmation and credential setup']
        })
      ]
    );

    return {
      requestId,
      addonName: addon.name,
      status: ADDON_REQUEST_STATUSES.REQUESTED,
      message: `Request for ${addon.name} received successfully.`
    };
  }

  /**
   * Resolves all active requests for an Organization
   */
  static async getOrganizationRequests(organizationId) {
    const rows = await db.all(
      `SELECT * FROM local_preferences WHERE key LIKE 'addon_req_%'`
    );

    const requests = [];
    for (const r of rows) {
      try {
        const payload = JSON.parse(r.value_payload);
        if (payload.organizationId === organizationId) {
          requests.push(payload);
        }
      } catch (_) {}
    }
    return requests;
  }

  /**
   * Administrative status update
   */
  static async updateRequestStatus(requestId, status, adminNotes = '') {
    const key = `addon_req_${requestId}`;
    const row = await db.get(`SELECT * FROM local_preferences WHERE key = ?`, [key]);
    if (!row) throw new Error('Request not found');

    const payload = JSON.parse(row.value_payload);
    payload.status = status;
    payload.adminNotes = adminNotes;
    payload.updatedAt = Date.now();

    if (status === ADDON_REQUEST_STATUSES.ACTIVE || status === ADDON_REQUEST_STATUSES.APPROVED) {
      await db.run(
        `INSERT OR REPLACE INTO local_preferences (key, value_payload) VALUES (?, 'ACTIVE')`,
        [`addon_active_${payload.organizationId}_${payload.addonId}`]
      );
    }

    await db.run(`UPDATE local_preferences SET value_payload = ? WHERE key = ?`, [
      JSON.stringify(payload),
      key
    ]);

    return payload;
  }
}

module.exports = {
  ADDON_REQUEST_STATUSES,
  AddonRequestService
};
