// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - DETERMINISTIC INVENTORY INTELLIGENCE
// 100% Deterministic stock velocity, reorder point, and days remaining math
// NO AI APIs — Zero recurring infrastructure cost
// ============================================================================

class InventoryIntelligenceEngine {
  /**
   * Calculates sales velocity and reorder metrics for a product catalog item
   */
  static calculateProductMetrics(product, unitsSoldPeriod, daysInPeriod = 30) {
    const stock = Number(product.stock_level ?? 0);
    const leadTimeDays = Number(product.supplier_lead_time_days || 2);
    const safetyStock = Number(product.safety_stock_units || 5);
    const preferredQty = Number(product.preferred_order_qty || 30);

    // 1. Average Daily Sales = units sold / days
    const averageDailySales = daysInPeriod > 0 ? unitsSoldPeriod / daysInPeriod : 0;

    // 2. Estimated Days Remaining = current stock / average daily sales
    let estimatedDaysRemaining = null;
    if (averageDailySales > 0) {
      estimatedDaysRemaining = Math.round((stock / averageDailySales) * 10) / 10;
    } else {
      estimatedDaysRemaining = stock > 0 ? 999 : 0;
    }

    // 3. Reorder Point = (average daily sales * lead time) + safety stock
    const reorderPoint = Math.ceil((averageDailySales * leadTimeDays) + safetyStock);

    // 4. Alert Status Classification
    let alertStatus = 'HEALTHY';
    let alertSeverity = 'NONE';
    let recommendation = null;

    if (stock <= 0) {
      alertStatus = 'OUT_OF_STOCK';
      alertSeverity = 'CRITICAL';
      recommendation = `Product '${product.name}' is out of stock. Immediate reorder of ${preferredQty} units recommended.`;
    } else if (stock <= reorderPoint || (estimatedDaysRemaining !== null && estimatedDaysRemaining <= leadTimeDays + 1)) {
      alertStatus = 'REORDER_RECOMMENDED';
      alertSeverity = 'HIGH';
      recommendation = `'${product.name}' stock (${stock}) is near reorder threshold. Stock may deplete in ${estimatedDaysRemaining} days.`;
    } else if (unitsSoldPeriod === 0 && stock > 50 && daysInPeriod >= 30) {
      alertStatus = 'SLOW_MOVING';
      alertSeverity = 'LOW';
      recommendation = `'${product.name}' has 0 sales in past ${daysInPeriod} days. Consider promotion or bundle deal.`;
    }

    return {
      sku: product.sku,
      name: product.name,
      currentStock: stock,
      unitsSoldPeriod,
      averageDailySales: Math.round(averageDailySales * 100) / 100,
      estimatedDaysRemaining,
      reorderPoint,
      suggestedReorderQty: preferredQty,
      alertStatus,
      alertSeverity,
      recommendation
    };
  }

  /**
   * Generates catalog-wide inventory health summary
   */
  static generateCatalogAudit(productsWithSales) {
    const results = productsWithSales.map(p => 
      this.calculateProductMetrics(p.product, p.unitsSold, p.days || 30)
    );

    const critical = results.filter(r => r.alertSeverity === 'CRITICAL');
    const high = results.filter(r => r.alertSeverity === 'HIGH');
    const slow = results.filter(r => r.alertStatus === 'SLOW_MOVING');
    const healthyCount = results.filter(r => r.alertStatus === 'HEALTHY').length;

    const healthyPct = results.length > 0 ? Math.round((healthyCount / results.length) * 100) : 100;

    return {
      totalProducts: results.length,
      healthyPercentage: healthyPct,
      criticalCount: critical.length,
      reorderCount: high.length,
      slowMovingCount: slow.length,
      items: results,
      actionableAlerts: [...critical, ...high]
    };
  }
}

module.exports = InventoryIntelligenceEngine;
