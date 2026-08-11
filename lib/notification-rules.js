// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - DETERMINISTIC NOTIFICATION ENGINE
// Rule-based notification engine: WHAT happened, WHY it matters, WHAT action to take
// NO AI APIs — Zero recurring infrastructure cost
// ============================================================================

class NotificationRuleEngine {
  constructor() {
    this.notifications = [];
    this.cooldowns = new Map(); // key -> timestamp
  }

  /**
   * Generates a rule-based notification with deduplication and cooldown
   */
  createNotification({ ruleId, severity, title, what, why, actionLabel, actionPayload, cooldownMinutes = 60 }) {
    const now = Date.now();
    const cooldownKey = `${ruleId}_${JSON.stringify(actionPayload)}`;
    const lastTriggered = this.cooldowns.get(cooldownKey) || 0;

    if (now - lastTriggered < cooldownMinutes * 60 * 1000) {
      return null; // Suppress duplicate notification within cooldown window
    }

    const notification = {
      id: `NOTIF_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ruleId,
      severity, // CRITICAL, WARNING, INFO
      title,
      what,
      why,
      actionLabel,
      actionPayload,
      timestamp: now,
      isRead: false
    };

    this.notifications.unshift(notification);
    this.cooldowns.set(cooldownKey, now);

    return notification;
  }

  /**
   * Evaluates catalog health and emits stockout / reorder notifications
   */
  evaluateInventoryAlerts(catalogAudit) {
    const generated = [];
    for (const item of catalogAudit.actionableAlerts) {
      if (item.alertSeverity === 'CRITICAL') {
        const notif = this.createNotification({
          ruleId: 'RULE_STOCK_OUT',
          severity: 'CRITICAL',
          title: `Stockout Alert: ${item.name}`,
          what: `Product '${item.name}' has 0 units remaining in stock.`,
          why: `Customers cannot purchase this item, leading to lost sales revenue.`,
          actionLabel: 'Create Purchase Order',
          actionPayload: { targetScreen: 'purchase-orders', sku: item.sku, suggestedQty: item.suggestedReorderQty },
          cooldownMinutes: 120
        });
        if (notif) generated.push(notif);
      } else if (item.alertSeverity === 'HIGH') {
        const notif = this.createNotification({
          ruleId: 'RULE_REORDER_SOON',
          severity: 'WARNING',
          title: `Reorder Recommended: ${item.name}`,
          what: `'${item.name}' stock level (${item.currentStock}) is at or below reorder threshold (${item.reorderPoint}).`,
          why: `Stock is estimated to deplete within ${item.estimatedDaysRemaining} days based on sales velocity.`,
          actionLabel: 'Reorder Stock',
          actionPayload: { targetScreen: 'inventory-adjust', sku: item.sku },
          cooldownMinutes: 240
        });
        if (notif) generated.push(notif);
      }
    }
    return generated;
  }

  getNotifications(unreadOnly = false) {
    if (unreadOnly) return this.notifications.filter(n => !n.isRead);
    return this.notifications;
  }

  markRead(id) {
    const notif = this.notifications.find(n => n.id === id);
    if (notif) notif.isRead = true;
  }
}

module.exports = NotificationRuleEngine;
