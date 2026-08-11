// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - PLATFORM ADMIN AUTHORIZATION & BOOTSTRAP
// Server-authoritative Platform Admin role hierarchy, secrets isolation, and audit logs
// ============================================================================

const { db } = require('../database');
const crypto = require('crypto');

const PLATFORM_ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  ORGANIZATION_OWNER: 'ORGANIZATION_OWNER',
  STAFF: 'STAFF'
};

class PlatformAdminService {
  /**
   * Initializes the bootstrap Platform Admin account safely server-side
   * Secrets are NEVER exposed to client JavaScript
   */
  static async bootstrapPlatformAdmin(adminEmail, bootstrapSecret) {
    const envEmail = process.env.VALENIXIA_ADMIN_EMAIL || adminEmail;
    const envSecret = process.env.VALENIXIA_ADMIN_BOOTSTRAP_SECRET || bootstrapSecret;

    if (!envEmail || !envSecret) {
      console.warn('[PlatformAdmin] Admin email or bootstrap secret not configured in environment.');
      return null;
    }

    const existing = await db.get(`SELECT * FROM accounts WHERE email = ?`, [envEmail]);
    
    if (existing) {
      await db.run(`UPDATE accounts SET role = ? WHERE email = ?`, [PLATFORM_ROLES.PLATFORM_ADMIN, envEmail]);
      return { email: envEmail, role: PLATFORM_ROLES.PLATFORM_ADMIN, bootstrapped: false };
    }

    const adminId = `ACC_ADMIN_${Date.now()}`;
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.pbkdf2Sync(envSecret, salt, 1000, 64, 'sha512').toString('hex');

    await db.run(
      `INSERT INTO accounts (id, email, password_hash, salt, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [adminId, envEmail, passwordHash, salt, PLATFORM_ROLES.PLATFORM_ADMIN, Date.now()]
    );

    await this.logAdminAuditAction(adminId, 'BOOTSTRAP_ADMIN_CREATED', { email: envEmail });

    return {
      adminId,
      email: envEmail,
      role: PLATFORM_ROLES.PLATFORM_ADMIN,
      bootstrapped: true
    };
  }

  /**
   * Validates Admin Session Password securely using PBKDF2
   */
  static async authenticateAdminPassword(email, password) {
    const account = await db.get(`SELECT * FROM accounts WHERE email = ? AND role = ?`, [email, PLATFORM_ROLES.PLATFORM_ADMIN]);
    if (!account) return { authenticated: false, reason: 'Invalid admin credentials' };

    const hashCheck = crypto.pbkdf2Sync(password, account.salt, 1000, 64, 'sha512').toString('hex');
    if (hashCheck !== account.password_hash) {
      return { authenticated: false, reason: 'Invalid admin credentials' };
    }

    return {
      authenticated: true,
      adminId: account.id,
      email: account.email,
      role: account.role,
      token: `ADMIN_SES_${crypto.randomBytes(24).toString('hex')}`,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000 // 8 Hour session duration
    };
  }

  /**
   * Evaluates if a given account possesses PLATFORM_ADMIN role
   */
  static async isPlatformAdmin(accountId) {
    if (!accountId) return false;
    const account = await db.get(`SELECT role FROM accounts WHERE id = ?`, [accountId]);
    return !!(account && account.role === PLATFORM_ROLES.PLATFORM_ADMIN);
  }

  /**
   * Writes immutable audit action log
   */
  static async logAdminAuditAction(adminId, actionType, payload) {
    const auditId = `AUDIT_ADM_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    await db.run(
      `INSERT INTO local_preferences (key, value_payload) VALUES (?, ?)`,
      [
        `admin_audit_${auditId}`,
        JSON.stringify({
          id: auditId,
          adminId,
          actionType,
          payload,
          timestamp: Date.now()
        })
      ]
    );
    return auditId;
  }
}

module.exports = {
  PLATFORM_ROLES,
  PlatformAdminService
};
