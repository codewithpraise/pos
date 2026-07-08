package com.nexova.commerce.db

import com.nexova.commerce.crdt.HLC
import com.nexova.commerce.crdt.SyncChange
import com.nexova.commerce.crdt.shouldApplyDelta
import kotlin.math.max
import kotlinx.serialization.Serializable
import java.security.spec.KeySpec
import java.sql.Connection
import java.sql.DriverManager
import java.sql.ResultSet
import java.util.UUID
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

@Serializable
data class InventoryItem(
    val sku: String,
    val gtin: String?,
    val name: String,
    val basePriceMinorUnits: Long,
    var stockLevel: Int,
    val reservedStock: Int,
    val colVersion: Long,
    val syncHlc: String,
    val category: String = "Uncategorized",
    val emoji: String = "",
    val costPriceMinorUnits: Long = 0,
    val lowStockThreshold: Int = 5
)

@Serializable
data class CartItem(
    val sku: String,
    val name: String,
    val basePriceMinorUnits: Long,
    val qty: Int
)

@Serializable
data class Employee(
    val id: String,
    val role: String,
    val isActive: Boolean
)

@Serializable
data class Preference(
    val key: String,
    val valueType: String,
    val valuePayload: String
)

// ── Transaction record returned by history queries
@Serializable
data class TransactionRecord(
    val id: String,
    val employeeId: String,
    val terminalId: String,
    val subtotalMinorUnits: Long,
    val taxMinorUnits: Long,
    val totalMinorUnits: Long,
    val status: String,
    val createdAt: Long,
    val customerId: String? = null,
    val paymentDetails: String? = null
)

// ── A single line item within a transaction
@Serializable
data class TransactionLineDetail(
    val id: String,
    val transactionId: String,
    val sku: String,
    val quantity: Int,
    val unitPriceMinorUnits: Long,
    val discountMinorUnits: Long
)

@Serializable
data class Customer(
    val id: String,
    val name: String,
    val phone: String,
    val email: String,
    val totalSpendCents: Long,
    val visits: Int,
    val createdAt: Long,
    val syncHlc: String
)

@Serializable
data class StockMovement(
    val id: String,
    val sku: String,
    val changeQty: Int,
    val reason: String,
    val createdAt: Long,
    val syncHlc: String
)

@Serializable
data class EmployeeShift(
    val id: String,
    val employeeId: String,
    val clockIn: Long,
    val clockOut: Long?,
    val syncHlc: String
)

// ── Analytics snapshot
data class AnalyticsOverview(
    val totalRevenueCents: Long,
    val totalTransactions: Int,
    val avgOrderValueCents: Long,
    val totalItemsSold: Int
)

data class DailySalesPoint(
    val dateLabel: String,   // "Jun 20"
    val revenueCents: Long
)

data class TopProduct(
    val sku: String,
    val name: String,
    val unitsSold: Int,
    val revenueCents: Long
)

object Database {
    private var conn: Connection? = null
    lateinit var hlc: HLC
    var dbVersion: Long = 0L

    // PBKDF2 password hashing helpers
    private fun hashPin(pin: String, salt: String = generateSalt()): String {
        val spec: KeySpec = PBEKeySpec(pin.toCharArray(), salt.toByteArray(), 100000, 512)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val hash = factory.generateSecret(spec).encoded
        val hexHash = hash.joinToString("") { "%02x".format(it) }
        return "$salt:$hexHash"
    }

    private fun verifyPin(pin: String, storedHash: String): Boolean {
        if (!storedHash.contains(":")) return false
        val parts = storedHash.split(":")
        val salt = parts[0]
        val hash = parts[1]
        
        val spec: KeySpec = PBEKeySpec(pin.toCharArray(), salt.toByteArray(), 100000, 512)
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val checkHash = factory.generateSecret(spec).encoded.joinToString("") { "%02x".format(it) }
        return java.security.MessageDigest.isEqual(hash.toByteArray(), checkHash.toByteArray())
    }

    private fun generateSalt(): String {
        val bytes = ByteArray(16)
        java.security.SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    @Synchronized
    fun initDatabase(terminalId: String) {
        hlc = HLC(terminalId)
        Class.forName("org.sqlite.JDBC")
        conn = DriverManager.getConnection("jdbc:sqlite:nexova.db")

        // Enable Write-Ahead Logging (WAL) & Foreign Keys & Safety Performance PRAGMAs
        conn?.createStatement()?.use { stmt ->
            stmt.execute("PRAGMA journal_mode = WAL;")
            stmt.execute("PRAGMA synchronous = NORMAL;")
            stmt.execute("PRAGMA busy_timeout = 5000;")
            stmt.execute("PRAGMA foreign_keys = ON;")
            
            println("[Database] Executing transactional index optimization pass...")
            try {
                stmt.execute("PRAGMA reindex;")
                stmt.execute("PRAGMA vacuum;")
                stmt.execute("PRAGMA analyze;")
                println("[Database] SQLite optimization pass completed successfully.")
            } catch (e: Exception) {
                println("[Database] SQLite optimization pass failed: ${e.message}")
            }
        }

        createSchemas()
        loadDbVersion()

        // Auto-approve Master PC
        conn?.prepareStatement("""
            INSERT OR REPLACE INTO approved_devices (node_id, device_name, user_agent, approved_at, status)
            VALUES (?, ?, ?, ?, ?)
        """)?.use { pstmt ->
            pstmt.setString(1, terminalId)
            pstmt.setString(2, "Master Register PC")
            pstmt.setString(3, "JVM Runtime")
            pstmt.setLong(4, System.currentTimeMillis())
            pstmt.setString(5, "APPROVED")
            pstmt.executeUpdate()
        }

        // Auto-approve Master PC (Web Node ID)
        conn?.prepareStatement("""
            INSERT OR REPLACE INTO approved_devices (node_id, device_name, user_agent, approved_at, status)
            VALUES (?, ?, ?, ?, ?)
        """)?.use { pstmt ->
            pstmt.setString(1, "nexova_master_pc_01")
            pstmt.setString(2, "Master Register PC (Web UI)")
            pstmt.setString(3, "Browser UI")
            pstmt.setLong(4, System.currentTimeMillis())
            pstmt.setString(5, "APPROVED")
            pstmt.executeUpdate()
        }

        // Seed if empty, otherwise run upgrades
        if (getInventoryCount() == 0) {
            seedDatabase()
        } else {
            upgradeSeedData()
        }
    }

    private fun createSchemas() {
        conn?.createStatement()?.use { stmt ->
            // Create core tables
            stmt.execute("""
                CREATE TABLE IF NOT EXISTS transactions (
                    id TEXT PRIMARY KEY,
                    employee_id TEXT,
                    terminal_id TEXT,
                    subtotal_minor_units INTEGER,
                    tax_minor_units INTEGER,
                    total_minor_units INTEGER,
                    status TEXT,
                    created_at INTEGER,
                    updated_at INTEGER,
                    sync_hlc TEXT,
                    is_dirty INTEGER,
                    is_deleted INTEGER
                );
            """)

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS line_items (
                    id TEXT PRIMARY KEY,
                    transaction_id TEXT,
                    sku TEXT,
                    quantity INTEGER,
                    unit_price_minor_units INTEGER,
                    applied_discount_minor_units INTEGER,
                    sync_hlc TEXT,
                    is_deleted INTEGER,
                    FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
                );
            """)

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS inventory_catalog (
                    sku TEXT PRIMARY KEY,
                    gtin TEXT UNIQUE,
                    name TEXT,
                    base_price_minor_units INTEGER,
                    stock_level INTEGER,
                    reserved_stock INTEGER,
                    search_vector TEXT,
                    col_version INTEGER,
                    sync_hlc TEXT
                );
            """)

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS employees (
                    id TEXT PRIMARY KEY,
                    auth_hash TEXT,
                    biometric_token TEXT,
                    role TEXT,
                    is_active INTEGER,
                    sync_hlc TEXT
                );
            """)

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS crsql_changes (
                    table_name TEXT,
                    pk TEXT,
                    cid TEXT,
                    val TEXT,
                    col_version INTEGER,
                    db_version INTEGER,
                    site_id TEXT,
                    cl INTEGER,
                    sync_hlc TEXT,
                    PRIMARY KEY (table_name, pk, cid)
                );
            """)

            stmt.execute("""
                CREATE TABLE IF NOT EXISTS local_preferences (
                    key TEXT PRIMARY KEY,
                    value_type TEXT,
                    value_payload TEXT,
                    is_idempotent_flag INTEGER,
                    updated_at INTEGER
                );
            """)

            // Create Customers table
            stmt.execute("""
                CREATE TABLE IF NOT EXISTS customers (
                    id TEXT PRIMARY KEY,
                    name TEXT,
                    phone TEXT,
                    email TEXT,
                    total_spend_cents INTEGER DEFAULT 0,
                    visits INTEGER DEFAULT 0,
                    created_at INTEGER,
                    sync_hlc TEXT
                );
            """)

            // Create Categories table
            stmt.execute("""
                CREATE TABLE IF NOT EXISTS categories (
                    name TEXT PRIMARY KEY,
                    sync_hlc TEXT
                );
            """)

            // Create stock movements table
            stmt.execute("""
                CREATE TABLE IF NOT EXISTS stock_movements (
                    id TEXT PRIMARY KEY,
                    sku TEXT,
                    change_qty INTEGER,
                    reason TEXT,
                    created_at INTEGER,
                    sync_hlc TEXT
                );
            """)

            // Create employee shifts table
            stmt.execute("""
                CREATE TABLE IF NOT EXISTS employee_shifts (
                    id TEXT PRIMARY KEY,
                    employee_id TEXT,
                    clock_in INTEGER,
                    clock_out INTEGER,
                    sync_hlc TEXT
                );
            """)

            // Create speech analytics logs table
            stmt.execute("""
                CREATE TABLE IF NOT EXISTS speech_analytics_logs (
                    id TEXT PRIMARY KEY,
                    transaction_id TEXT,
                    utterance_duration_ms INTEGER,
                    speaker_diarization_tag TEXT,
                    filler_word_count INTEGER,
                    sentiment_score TEXT,
                    flagged_fraud_risk INTEGER,
                    disfluency_markers TEXT,
                    sync_hlc TEXT
                );
            """)

            // Create approved devices table
            stmt.execute("""
                CREATE TABLE IF NOT EXISTS approved_devices (
                    node_id TEXT PRIMARY KEY,
                    device_name TEXT,
                    user_agent TEXT,
                    approved_at INTEGER,
                    status TEXT
                );
            """)

            // Apply migrations (ALTER TABLE try-catches)
            try { stmt.execute("ALTER TABLE inventory_catalog ADD COLUMN category TEXT DEFAULT 'Uncategorized';") } catch (e: Exception) {}
            try { stmt.execute("ALTER TABLE inventory_catalog ADD COLUMN emoji TEXT DEFAULT '';") } catch (e: Exception) {}
            try { stmt.execute("ALTER TABLE inventory_catalog ADD COLUMN cost_price_minor_units INTEGER DEFAULT 0;") } catch (e: Exception) {}
            try { stmt.execute("ALTER TABLE inventory_catalog ADD COLUMN low_stock_threshold INTEGER DEFAULT 5;") } catch (e: Exception) {}
            try { stmt.execute("ALTER TABLE transactions ADD COLUMN customer_id TEXT;") } catch (e: Exception) {}
            try { stmt.execute("ALTER TABLE transactions ADD COLUMN payment_details TEXT;") } catch (e: Exception) {}

            // Create Indexes
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_transactions_status_created ON transactions(status, created_at);")
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_transactions_hlc_dirty ON transactions(sync_hlc, is_dirty);")
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_line_items_tx ON line_items(transaction_id);")
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_line_items_sku ON line_items(sku);")
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);")
            stmt.execute("CREATE INDEX IF NOT EXISTS idx_stock_movements_sku ON stock_movements(sku);")
        }
    }

    private fun loadDbVersion() {
        conn?.prepareStatement("SELECT MAX(db_version) FROM crsql_changes")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                if (rs.next()) {
                    dbVersion = rs.getLong(1)
                }
            }
        }
    }

    private fun getInventoryCount(): Int {
        conn?.prepareStatement("SELECT COUNT(*) FROM inventory_catalog")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                if (rs.next()) return rs.getInt(1)
            }
        }
        return 0
    }

    private fun seedDatabase() {
        val now = System.currentTimeMillis()

        conn?.autoCommit = false
        try {
            // 1. Seed Employees
            val adminId = UUID.randomUUID().toString()
            val cashierId = UUID.randomUUID().toString()
            
            val adminHlc = hlc.tick()
            val cashierHlc = hlc.tick()

            insertEmployeeDirect(adminId, hashPin("1234"), "ADMIN", adminHlc)
            insertEmployeeDirect(cashierId, hashPin("5678"), "CASHIER", cashierHlc)

            // 2. Seed Catalog with Premium realistic details (categories, emojis, cost, low stock thresholds)
            val catalog = listOf(
                InventoryItem("COFFEE-ESP", "0000000000001", "Signature Espresso", 350L, 100, 0, 1L, hlc.tick(), "Beverages", "", 120L, 10),
                InventoryItem("COFFEE-LAT", "0000000000002", "Cold Brew Latte", 475L, 80, 0, 1L, hlc.tick(), "Beverages", "", 180L, 8),
                InventoryItem("COFFEE-CBD", "0000000000003", "Nitro Cold Brew", 550L, 60, 0, 1L, hlc.tick(), "Beverages", "", 220L, 8),
                InventoryItem("PASTRY-CRO", "0000000000004", "Butter Croissant", 325L, 40, 0, 1L, hlc.tick(), "Bakery", "", 110L, 5),
                InventoryItem("PASTRY-MUF", "0000000000005", "Blueberry Muffin", 375L, 30, 0, 1L, hlc.tick(), "Bakery", "", 130L, 5),
                InventoryItem("PASTRY-COK", "0000000000006", "Choco Chip Cookie", 250L, 50, 0, 1L, hlc.tick(), "Bakery", "", 80L, 10),
                InventoryItem("TECH-CHG",  "0000000000007", "Rapid USB-C Charger", 1999L, 25, 0, 1L, hlc.tick(), "Electronics", "", 750L, 5),
                InventoryItem("TECH-CBL",  "0000000000008", "Braid Type-C Cable 1m", 999L, 45, 0, 1L, hlc.tick(), "Electronics", "", 300L, 5),
                InventoryItem("RETAIL-MUG", "0000000000009", "Nexova Ceramic Mug", 1450L, 20, 0, 1L, hlc.tick(), "Merchandise", "", 450L, 3),
                InventoryItem("RETAIL-TSH", "0000000000010", "Nova Cotton Tee (L)", 2499L, 15, 0, 1L, hlc.tick(), "Merchandise", "", 950L, 4),
                InventoryItem("RETAIL-BAG", "0000000000011", "Canvas Tote Bag", 1200L, 35, 0, 1L, hlc.tick(), "Merchandise", "", 380L, 5),
                InventoryItem("WATER-SPK", "0000000000012", "Sparkling Mineral Water", 200L, 120, 0, 1L, hlc.tick(), "Beverages", "", 60L, 15)
            )

            catalog.forEach { item ->
                insertInventoryDirect(item)
            }

            // 3. Seed preferences
            val seedPrefs = listOf(
                Triple("onboarding_complete", "BOOL", "true"),
                Triple("store_name", "STR", "NEXOVA COFFEE & RETAIL"),
                Triple("store_theme_palette", "STR", "Obsidian Emerald"),
                Triple("store_logo_emoji", "STR", "☕"),
                Triple("store_tax_rate", "STR", "0.08"),
                Triple("store_receipt_tagline", "STR", "Stability meets Speed. Thank you!"),
                Triple("whitelabel_show_branding", "STR", "true"),
                Triple("glassmorphism_enabled", "STR", "true"),
                Triple("terminal_name", "STR", "Nexova Master PC 01"),
                Triple("store_receipt_width", "STR", "42")
            )
            conn?.prepareStatement("INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, ?, ?, 0, ?)")?.use { pstmt ->
                seedPrefs.forEach { pref ->
                    pstmt.setString(1, pref.first)
                    pstmt.setString(2, pref.second)
                    pstmt.setString(3, pref.third)
                    pstmt.setLong(4, now)
                    pstmt.executeUpdate()
                }
            }

            conn?.commit()
        } catch (ex: Exception) {
            conn?.rollback()
            throw ex
        } finally {
            conn?.autoCommit = true
        }
    }

    private fun upgradeSeedData() {
        try {
            conn?.createStatement()?.use { stmt ->
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Beverages', emoji = '', cost_price_minor_units = 120, low_stock_threshold = 10 WHERE sku = 'COFFEE-ESP' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Beverages', emoji = '', cost_price_minor_units = 180, low_stock_threshold = 8 WHERE sku = 'COFFEE-LAT' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Beverages', emoji = '', cost_price_minor_units = 220, low_stock_threshold = 8 WHERE sku = 'COFFEE-CBD' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Bakery', emoji = '', cost_price_minor_units = 110, low_stock_threshold = 5 WHERE sku = 'PASTRY-CRO' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Bakery', emoji = '', cost_price_minor_units = 130, low_stock_threshold = 5 WHERE sku = 'PASTRY-MUF' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Bakery', emoji = '', cost_price_minor_units = 80, low_stock_threshold = 10 WHERE sku = 'PASTRY-COK' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Electronics', emoji = '', cost_price_minor_units = 750, low_stock_threshold = 5 WHERE sku = 'TECH-CHG' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Electronics', emoji = '', cost_price_minor_units = 300, low_stock_threshold = 5 WHERE sku = 'TECH-CBL' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Merchandise', emoji = '', cost_price_minor_units = 450, low_stock_threshold = 3 WHERE sku = 'RETAIL-MUG' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Merchandise', emoji = '', cost_price_minor_units = 950, low_stock_threshold = 4 WHERE sku = 'RETAIL-TSH' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Merchandise', emoji = '', cost_price_minor_units = 380, low_stock_threshold = 5 WHERE sku = 'RETAIL-BAG' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
                stmt.executeUpdate("UPDATE inventory_catalog SET category = 'Beverages', emoji = '', cost_price_minor_units = 60, low_stock_threshold = 15 WHERE sku = 'WATER-SPK' AND (category = 'Uncategorized' OR category IS NULL OR category = '');")
            }
        } catch (e: Exception) {
            println("[DB] Upgrade seed data failed: ${e.message}")
        }
    }

    private fun insertEmployeeDirect(id: String, hash: String, role: String, hlcStr: String) {
        conn?.prepareStatement("INSERT INTO employees (id, auth_hash, role, is_active, sync_hlc) VALUES (?, ?, ?, 1, ?)")?.use { pstmt ->
            pstmt.setString(1, id)
            pstmt.setString(2, hash)
            pstmt.setString(3, role)
            pstmt.setString(4, hlcStr)
            pstmt.executeUpdate()
        }
        logLocalChange("employees", id, "auth_hash", hash, 1L, 1, hlcStr)
        logLocalChange("employees", id, "role", role, 1L, 1, hlcStr)
        logLocalChange("employees", id, "is_active", "1", 1L, 1, hlcStr)
    }

    private fun insertInventoryDirect(item: InventoryItem) {
        conn?.prepareStatement("""
            INSERT INTO inventory_catalog (sku, gtin, name, base_price_minor_units, stock_level, reserved_stock, search_vector, col_version, sync_hlc, category, emoji, cost_price_minor_units, low_stock_threshold)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """)?.use { pstmt ->
            pstmt.setString(1, item.sku)
            pstmt.setString(2, item.gtin)
            pstmt.setString(3, item.name)
            pstmt.setLong(4, item.basePriceMinorUnits)
            pstmt.setInt(5, item.stockLevel)
            pstmt.setInt(6, item.reservedStock)
            pstmt.setString(7, "${item.sku} ${item.name} ${item.gtin}".lowercase())
            pstmt.setLong(8, item.colVersion)
            pstmt.setString(9, item.syncHlc)
            pstmt.setString(10, item.category)
            pstmt.setString(11, item.emoji)
            pstmt.setLong(12, item.costPriceMinorUnits)
            pstmt.setInt(13, item.lowStockThreshold)
            pstmt.executeUpdate()
        }
        logLocalChange("inventory_catalog", item.sku, "gtin", item.gtin, 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "name", item.name, 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "base_price_minor_units", item.basePriceMinorUnits.toString(), 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "stock_level", item.stockLevel.toString(), 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "reserved_stock", "0", 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "category", item.category, 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "emoji", item.emoji, 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "cost_price_minor_units", item.costPriceMinorUnits.toString(), 1L, 1, item.syncHlc)
        logLocalChange("inventory_catalog", item.sku, "low_stock_threshold", item.lowStockThreshold.toString(), 1L, 1, item.syncHlc)
    }

    @Synchronized
    fun getInventory(): List<InventoryItem> {
        val list = mutableListOf<InventoryItem>()
        conn?.prepareStatement("SELECT * FROM inventory_catalog ORDER BY name ASC")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(
                        InventoryItem(
                            sku = rs.getString("sku"),
                            gtin = rs.getString("gtin"),
                            name = rs.getString("name"),
                            basePriceMinorUnits = rs.getLong("base_price_minor_units"),
                            stockLevel = rs.getInt("stock_level"),
                            reservedStock = rs.getInt("reserved_stock"),
                            colVersion = rs.getLong("col_version"),
                            syncHlc = rs.getString("sync_hlc"),
                            category = rs.getString("category") ?: "Uncategorized",
                            emoji = rs.getString("emoji") ?: "",
                            costPriceMinorUnits = rs.getLong("cost_price_minor_units"),
                            lowStockThreshold = rs.getInt("low_stock_threshold")
                        )
                    )
                }
            }
        }
        return list
    }

    @Synchronized
    fun verifyEmployeePin(pin: String): Employee? {
        conn?.prepareStatement("SELECT id, role, auth_hash, is_active FROM employees WHERE is_active = 1")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    val hash = rs.getString("auth_hash")
                    if (verifyPin(pin, hash)) {
                        return Employee(
                            id = rs.getString("id"),
                            role = rs.getString("role"),
                            isActive = rs.getInt("is_active") == 1
                        )
                    }
                }
            }
        }
        return null
    }

    @Synchronized
    fun checkout(
        txId: String,
        employeeId: String,
        cart: List<CartItem>,
        subtotal: Long,
        tax: Long,
        total: Long,
        customerId: String? = null,
        paymentDetails: String? = null
    ): Boolean {
        val now = System.currentTimeMillis()
        conn?.autoCommit = false
        try {
            val txHlc = hlc.tick()
            // 1. Insert Transaction record
            conn?.prepareStatement("""
                INSERT INTO transactions (id, employee_id, terminal_id, subtotal_minor_units, tax_minor_units, total_minor_units, status, created_at, updated_at, sync_hlc, is_dirty, is_deleted, customer_id, payment_details)
                VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, 1, 0, ?, ?)
            """)?.use { pstmt ->
                pstmt.setString(1, txId)
                pstmt.setString(2, employeeId)
                pstmt.setString(3, hlc.nodeId)
                pstmt.setLong(4, subtotal)
                pstmt.setLong(5, tax)
                pstmt.setLong(6, total)
                pstmt.setLong(7, now)
                pstmt.setLong(8, now)
                pstmt.setString(9, txHlc)
                pstmt.setString(10, customerId)
                pstmt.setString(11, paymentDetails)
                pstmt.executeUpdate()
            }

            logLocalChange("transactions", txId, "employee_id", employeeId, 1L, 1, txHlc)
            logLocalChange("transactions", txId, "terminal_id", hlc.nodeId, 1L, 1, txHlc)
            logLocalChange("transactions", txId, "subtotal_minor_units", subtotal.toString(), 1L, 1, txHlc)
            logLocalChange("transactions", txId, "tax_minor_units", tax.toString(), 1L, 1, txHlc)
            logLocalChange("transactions", txId, "total_minor_units", total.toString(), 1L, 1, txHlc)
            logLocalChange("transactions", txId, "status", "COMPLETED", 1L, 1, txHlc)
            if (customerId != null) {
                logLocalChange("transactions", txId, "customer_id", customerId, 1L, 1, txHlc)
                updateCustomerStats(customerId, total)
            }
            if (paymentDetails != null) {
                logLocalChange("transactions", txId, "payment_details", paymentDetails, 1L, 1, txHlc)
            }

            // 2. Insert items and decrement stock
            cart.forEach { item ->
                val lineId = UUID.randomUUID().toString()
                val lineHlc = hlc.tick()
                
                conn?.prepareStatement("""
                    INSERT INTO line_items (id, transaction_id, sku, quantity, unit_price_minor_units, applied_discount_minor_units, sync_hlc, is_deleted)
                    VALUES (?, ?, ?, ?, ?, 0, ?, 0)
                """)?.use { pstmt ->
                    pstmt.setString(1, lineId)
                    pstmt.setString(2, txId)
                    pstmt.setString(3, item.sku)
                    pstmt.setInt(4, item.qty)
                    pstmt.setLong(5, item.basePriceMinorUnits)
                    pstmt.setString(6, lineHlc)
                    pstmt.executeUpdate()
                }

                logLocalChange("line_items", lineId, "transaction_id", txId, 1L, 1, lineHlc)
                logLocalChange("line_items", lineId, "sku", item.sku, 1L, 1, lineHlc)
                logLocalChange("line_items", lineId, "quantity", item.qty.toString(), 1L, 1, lineHlc)
                logLocalChange("line_items", lineId, "unit_price_minor_units", item.basePriceMinorUnits.toString(), 1L, 1, lineHlc)

                // Decrement Stock
                conn?.prepareStatement("SELECT stock_level, col_version FROM inventory_catalog WHERE sku = ?")?.use { pstmt ->
                    pstmt.setString(1, item.sku)
                    pstmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            val oldStock = rs.getInt("stock_level")
                            val newStock = max(0, oldStock - item.qty)
                            val newVer = rs.getLong("col_version") + 1
                            val stockHlc = hlc.tick()

                            conn?.prepareStatement("UPDATE inventory_catalog SET stock_level = ?, col_version = ?, sync_hlc = ? WHERE sku = ?")?.use { upstmt ->
                                upstmt.setInt(1, newStock)
                                upstmt.setLong(2, newVer)
                                upstmt.setString(3, stockHlc)
                                upstmt.setString(4, item.sku)
                                upstmt.executeUpdate()
                            }
                            logLocalChange("inventory_catalog", item.sku, "stock_level", newStock.toString(), newVer, 1, stockHlc)
                            addStockMovement(item.sku, -item.qty, "SALE (Tx: $txId)")
                        }
                    }
                }
            }

            conn?.commit()
            return true
        } catch (ex: Exception) {
            conn?.rollback()
            ex.printStackTrace()
            return false
        } finally {
            conn?.autoCommit = true
        }
    }

    @Synchronized
    fun getChangesSince(version: Long): List<SyncChange> {
        val list = mutableListOf<SyncChange>()
        conn?.prepareStatement("SELECT * FROM crsql_changes WHERE db_version > ? ORDER BY db_version ASC")?.use { pstmt ->
            pstmt.setLong(1, version)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(
                        SyncChange(
                            tableName = rs.getString("table_name"),
                            pk = rs.getString("pk"),
                            cid = rs.getString("cid"),
                            value = rs.getString("val"),
                            colVersion = rs.getLong("col_version"),
                            dbVersion = rs.getLong("db_version"),
                            siteId = rs.getString("site_id"),
                            cl = rs.getInt("cl"),
                            syncHlc = rs.getString("sync_hlc")
                        )
                    )
                }
            }
        }
        return list
    }

    @Synchronized
    fun applyRemoteChanges(changes: List<SyncChange>): Pair<Int, Int> {
        if (changes.isEmpty()) return Pair(0, 0)
        var applied = 0
        var conflicts = 0
        
        conn?.autoCommit = false
        try {
            changes.forEach { change ->
                hlc.merge(change.syncHlc)

                // Get local change details
                var localVer: Long? = null
                var localHlc: String? = null
                conn?.prepareStatement("SELECT col_version, sync_hlc FROM crsql_changes WHERE table_name = ? AND pk = ? AND cid = ?")?.use { pstmt ->
                    pstmt.setString(1, change.tableName)
                    pstmt.setString(2, change.pk)
                    pstmt.setString(3, change.cid)
                    pstmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            localVer = rs.getLong(1)
                            localHlc = rs.getString(2)
                        }
                    }
                }

                val shouldApply = if (localVer == null) {
                    true
                } else {
                    val localChange = SyncChange(
                        change.tableName, change.pk, change.cid, null, localVer!!, 0, "", 0, localHlc!!
                    )
                    shouldApplyDelta(localChange, change)
                }

                if (shouldApply) {
                    applied++
                    applyChangeToSchema(change.tableName, change.pk, change.cid, change.value, change.cl)
                    dbVersion++
                    conn?.prepareStatement("""
                        INSERT INTO crsql_changes (table_name, pk, cid, val, col_version, db_version, site_id, cl, sync_hlc)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(table_name, pk, cid) DO UPDATE SET
                          val = excluded.val,
                          col_version = excluded.col_version,
                          db_version = excluded.db_version,
                          site_id = excluded.site_id,
                          cl = excluded.cl,
                          sync_hlc = excluded.sync_hlc
                    """)?.use { pstmt ->
                        pstmt.setString(1, change.tableName)
                        pstmt.setString(2, change.pk)
                        pstmt.setString(3, change.cid)
                        pstmt.setString(4, change.value)
                        pstmt.setLong(5, change.colVersion)
                        pstmt.setLong(6, dbVersion)
                        pstmt.setString(7, change.siteId)
                        pstmt.setInt(8, change.cl)
                        pstmt.setString(9, change.syncHlc)
                        pstmt.executeUpdate()
                    }
                } else {
                    conflicts++
                }
            }
            conn?.commit()
        } catch (ex: Exception) {
            conn?.rollback()
            ex.printStackTrace()
            throw ex
        } finally {
            conn?.autoCommit = true
        }

        return Pair(applied, conflicts)
    }

    private fun applyChangeToSchema(tableName: String, pk: String, cid: String, value: String?, cl: Int) {
        val allowedColumns = when (tableName) {
            "transactions" -> setOf(
                "employee_id", "terminal_id", "subtotal_minor_units", "tax_minor_units",
                "total_minor_units", "status", "customer_id", "payment_details"
            )
            "line_items" -> setOf(
                "transaction_id", "sku", "quantity", "unit_price_minor_units", "applied_discount_minor_units"
            )
            "inventory_catalog" -> setOf(
                "gtin", "name", "base_price_minor_units", "stock_level", "reserved_stock",
                "category", "emoji", "cost_price_minor_units", "low_stock_threshold"
            )
            "local_preferences" -> setOf(
                "value_type", "value_payload"
            )
            else -> emptySet()
        }
        if (cid !in allowedColumns) {
            println("[SECURITY] Unauthorized dynamic schema update rejected for table: $tableName, column: $cid")
            return
        }

        if (cl == 0) {
            // soft deletion
            if (tableName == "transactions") {
                conn?.prepareStatement("UPDATE transactions SET is_deleted = 1, status = 'VOIDED' WHERE id = ?")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.executeUpdate()
                }
            } else if (tableName == "line_items") {
                conn?.prepareStatement("UPDATE line_items SET is_deleted = 1 WHERE id = ?")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.executeUpdate()
                }
            } else if (tableName == "inventory_catalog") {
                conn?.prepareStatement("UPDATE inventory_catalog SET stock_level = 0 WHERE sku = ?")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.executeUpdate()
                }
            } else if (tableName == "local_preferences") {
                conn?.prepareStatement("DELETE FROM local_preferences WHERE key = ?")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.executeUpdate()
                }
            }
            return
        }

        // Insert skeletal record if not exists
        if (tableName == "transactions") {
            var exists = false
            conn?.prepareStatement("SELECT 1 FROM transactions WHERE id = ?")?.use { pstmt ->
                pstmt.setString(1, pk)
                pstmt.executeQuery().use { rs -> exists = rs.next() }
            }
            if (!exists) {
                conn?.prepareStatement("INSERT INTO transactions (id, status, is_deleted, created_at) VALUES (?, 'DRAFT', 0, ?)")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.setLong(2, System.currentTimeMillis())
                    pstmt.executeUpdate()
                }
            }
            
            // Update column dynamically
            val sql = "UPDATE transactions SET $cid = ?, updated_at = ? WHERE id = ?"
            conn?.prepareStatement(sql)?.use { pstmt ->
                pstmt.setString(1, value)
                pstmt.setLong(2, System.currentTimeMillis())
                pstmt.setString(3, pk)
                pstmt.executeUpdate()
            }
        } 
        
        else if (tableName == "line_items") {
            var exists = false
            conn?.prepareStatement("SELECT 1 FROM line_items WHERE id = ?")?.use { pstmt ->
                pstmt.setString(1, pk)
                pstmt.executeQuery().use { rs -> exists = rs.next() }
            }
            if (!exists) {
                conn?.prepareStatement("INSERT INTO line_items (id, transaction_id, sku, quantity, unit_price_minor_units, applied_discount_minor_units, is_deleted) VALUES (?, ?, 'COFFEE-ESP', 1, 0, 0, 0)")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.setString(2, pk)
                    pstmt.executeUpdate()
                }
            }
            val sql = "UPDATE line_items SET $cid = ? WHERE id = ?"
            conn?.prepareStatement(sql)?.use { pstmt ->
                pstmt.setString(1, value)
                pstmt.setString(2, pk)
                pstmt.executeUpdate()
            }
        }
        
        else if (tableName == "inventory_catalog") {
            var exists = false
            conn?.prepareStatement("SELECT 1 FROM inventory_catalog WHERE sku = ?")?.use { pstmt ->
                pstmt.setString(1, pk)
                pstmt.executeQuery().use { rs -> exists = rs.next() }
            }
            if (!exists) {
                conn?.prepareStatement("INSERT INTO inventory_catalog (sku, stock_level, reserved_stock, name, base_price_minor_units) VALUES (?, 0, 0, ?, 0)")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.setString(2, pk)
                    pstmt.executeUpdate()
                }
            }
            val sql = "UPDATE inventory_catalog SET $cid = ? WHERE sku = ?"
            conn?.prepareStatement(sql)?.use { pstmt ->
                pstmt.setString(1, value)
                pstmt.setString(2, pk)
                pstmt.executeUpdate()
            }
        }
        
        else if (tableName == "local_preferences") {
            var exists = false
            conn?.prepareStatement("SELECT 1 FROM local_preferences WHERE key = ?")?.use { pstmt ->
                pstmt.setString(1, pk)
                pstmt.executeQuery().use { rs -> exists = rs.next() }
            }
            if (!exists) {
                conn?.prepareStatement("INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at) VALUES (?, 'STR', '', 0, ?)")?.use { pstmt ->
                    pstmt.setString(1, pk)
                    pstmt.setLong(2, System.currentTimeMillis())
                    pstmt.executeUpdate()
                }
            }
            val sql = "UPDATE local_preferences SET $cid = ?, updated_at = ? WHERE key = ?"
            conn?.prepareStatement(sql)?.use { pstmt ->
                pstmt.setString(1, value)
                pstmt.setLong(2, System.currentTimeMillis())
                pstmt.setString(3, pk)
                pstmt.executeUpdate()
            }
        }
    }

    @Synchronized
    private fun logLocalChange(tableName: String, pk: String, cid: String, value: String?, colVersion: Long, cl: Int, syncHlc: String) {
        dbVersion++
        conn?.prepareStatement("""
            INSERT INTO crsql_changes (table_name, pk, cid, val, col_version, db_version, site_id, cl, sync_hlc)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(table_name, pk, cid) DO UPDATE SET
              val = excluded.val,
              col_version = excluded.col_version,
              db_version = excluded.db_version,
              site_id = excluded.site_id,
              cl = excluded.cl,
              sync_hlc = excluded.sync_hlc
        """)?.use { pstmt ->
            pstmt.setString(1, tableName)
            pstmt.setString(2, pk)
            pstmt.setString(3, cid)
            pstmt.setString(4, value)
            pstmt.setLong(5, colVersion)
            pstmt.setLong(6, dbVersion)
            pstmt.setString(7, hlc.nodeId)
            pstmt.setInt(8, cl)
            pstmt.setString(9, syncHlc)
            pstmt.executeUpdate()
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  INVENTORY CRUD
    // ──────────────────────────────────────────────────────────────────────────

    @Synchronized
    fun addInventoryItem(
        sku: String, gtin: String?, name: String,
        priceMinorUnits: Long, stockLevel: Int,
        category: String = "Uncategorized",
        emoji: String = "",
        costPriceMinorUnits: Long = 0,
        lowStockThreshold: Int = 5
    ): Boolean {
        // Check for duplicate SKU
        var exists = false
        conn?.prepareStatement("SELECT 1 FROM inventory_catalog WHERE sku = ?")?.use { pstmt ->
            pstmt.setString(1, sku.uppercase().trim())
            pstmt.executeQuery().use { rs -> exists = rs.next() }
        }
        if (exists) return false

        val hlcStr = hlc.tick()
        val item = InventoryItem(
            sku = sku.uppercase().trim(),
            gtin = gtin?.trim()?.ifEmpty { null },
            name = name.trim(),
            basePriceMinorUnits = priceMinorUnits,
            stockLevel = stockLevel,
            reservedStock = 0,
            colVersion = 1L,
            syncHlc = hlcStr,
            category = category.trim().ifEmpty { "Uncategorized" },
            emoji = emoji.trim().ifEmpty { "" },
            costPriceMinorUnits = costPriceMinorUnits,
            lowStockThreshold = lowStockThreshold
        )
        return try {
            insertInventoryDirect(item)
            if (stockLevel > 0) {
                addStockMovement(item.sku, stockLevel, "INITIAL STOCK")
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    @Synchronized
    fun updateInventoryPrice(sku: String, newPriceMinorUnits: Long): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement(
            "UPDATE inventory_catalog SET base_price_minor_units = ?, sync_hlc = ?, col_version = col_version + 1 WHERE sku = ?"
        )?.use { pstmt ->
            pstmt.setLong(1, newPriceMinorUnits)
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, sku)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("inventory_catalog", sku, "base_price_minor_units", newPriceMinorUnits.toString(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun updateInventoryStock(sku: String, newStock: Int): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        var oldStock = 0
        conn?.prepareStatement("SELECT stock_level FROM inventory_catalog WHERE sku = ?")?.use { pstmt ->
            pstmt.setString(1, sku)
            pstmt.executeQuery().use { rs ->
                if (rs.next()) oldStock = rs.getInt(1)
            }
        }
        conn?.prepareStatement(
            "UPDATE inventory_catalog SET stock_level = ?, sync_hlc = ?, col_version = col_version + 1 WHERE sku = ?"
        )?.use { pstmt ->
            pstmt.setInt(1, newStock)
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, sku)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("inventory_catalog", sku, "stock_level", newStock.toString(), dbVersion + 1, 1, hlcStr)
            addStockMovement(sku, newStock - oldStock, "MANUAL ADJUST")
        }
        return updated > 0
    }

    @Synchronized
    fun updateInventoryCategory(sku: String, newCategory: String): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement(
            "UPDATE inventory_catalog SET category = ?, sync_hlc = ?, col_version = col_version + 1 WHERE sku = ?"
        )?.use { pstmt ->
            pstmt.setString(1, newCategory.trim())
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, sku)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("inventory_catalog", sku, "category", newCategory.trim(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun updateInventoryEmoji(sku: String, newEmoji: String): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement(
            "UPDATE inventory_catalog SET emoji = ?, sync_hlc = ?, col_version = col_version + 1 WHERE sku = ?"
        )?.use { pstmt ->
            pstmt.setString(1, newEmoji.trim())
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, sku)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("inventory_catalog", sku, "emoji", newEmoji.trim(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun updateInventoryCost(sku: String, newCost: Long): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement(
            "UPDATE inventory_catalog SET cost_price_minor_units = ?, sync_hlc = ?, col_version = col_version + 1 WHERE sku = ?"
        )?.use { pstmt ->
            pstmt.setLong(1, newCost)
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, sku)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("inventory_catalog", sku, "cost_price_minor_units", newCost.toString(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun updateInventoryThreshold(sku: String, newThreshold: Int): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement(
            "UPDATE inventory_catalog SET low_stock_threshold = ?, sync_hlc = ?, col_version = col_version + 1 WHERE sku = ?"
        )?.use { pstmt ->
            pstmt.setInt(1, newThreshold)
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, sku)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("inventory_catalog", sku, "low_stock_threshold", newThreshold.toString(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun updateInventoryName(sku: String, newName: String): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement(
            "UPDATE inventory_catalog SET name = ?, search_vector = ?, sync_hlc = ?, col_version = col_version + 1 WHERE sku = ?"
        )?.use { pstmt ->
            pstmt.setString(1, newName.trim())
            pstmt.setString(2, "${sku} ${newName}".lowercase())
            pstmt.setString(3, hlcStr)
            pstmt.setString(4, sku)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("inventory_catalog", sku, "name", newName.trim(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun deleteInventoryItem(sku: String): Boolean {
        val hlcStr = hlc.tick()
        var deleted = 0
        conn?.prepareStatement("DELETE FROM inventory_catalog WHERE sku = ?")?.use { pstmt ->
            pstmt.setString(1, sku)
            deleted = pstmt.executeUpdate()
        }
        if (deleted > 0) {
            logLocalChange("inventory_catalog", sku, "stock_level", null, dbVersion + 1, 0, hlcStr)
        }
        return deleted > 0
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  TRANSACTION HISTORY
    // ──────────────────────────────────────────────────────────────────────────

    @Synchronized
    fun getTransactions(limit: Int = 200, statusFilter: String? = null): List<TransactionRecord> {
        val list = mutableListOf<TransactionRecord>()
        val sql = if (statusFilter != null) {
            "SELECT * FROM transactions WHERE is_deleted = 0 AND status = ? ORDER BY created_at DESC LIMIT ?"
        } else {
            "SELECT * FROM transactions WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT ?"
        }
        conn?.prepareStatement(sql)?.use { pstmt ->
            if (statusFilter != null) {
                pstmt.setString(1, statusFilter)
                pstmt.setInt(2, limit)
            } else {
                pstmt.setInt(1, limit)
            }
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(TransactionRecord(
                        id = rs.getString("id"),
                        employeeId = rs.getString("employee_id") ?: "",
                        terminalId = rs.getString("terminal_id") ?: "",
                        subtotalMinorUnits = rs.getLong("subtotal_minor_units"),
                        taxMinorUnits = rs.getLong("tax_minor_units"),
                        totalMinorUnits = rs.getLong("total_minor_units"),
                        status = rs.getString("status") ?: "COMPLETED",
                        createdAt = rs.getLong("created_at"),
                        customerId = rs.getString("customer_id"),
                        paymentDetails = rs.getString("payment_details")
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun getTransactionLines(transactionId: String): List<TransactionLineDetail> {
        val list = mutableListOf<TransactionLineDetail>()
        conn?.prepareStatement(
            "SELECT * FROM line_items WHERE transaction_id = ? AND is_deleted = 0"
        )?.use { pstmt ->
            pstmt.setString(1, transactionId)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(TransactionLineDetail(
                        id = rs.getString("id"),
                        transactionId = rs.getString("transaction_id"),
                        sku = rs.getString("sku"),
                        quantity = rs.getInt("quantity"),
                        unitPriceMinorUnits = rs.getLong("unit_price_minor_units"),
                        discountMinorUnits = rs.getLong("applied_discount_minor_units")
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun voidTransaction(txId: String): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.autoCommit = false
        try {
            conn?.prepareStatement(
                "UPDATE transactions SET status = 'VOIDED', updated_at = ?, sync_hlc = ? WHERE id = ?"
            )?.use { pstmt ->
                pstmt.setLong(1, System.currentTimeMillis())
                pstmt.setString(2, hlcStr)
                pstmt.setString(3, txId)
                updated = pstmt.executeUpdate()
            }
            if (updated > 0) {
                logLocalChange("transactions", txId, "status", "VOIDED", dbVersion + 1, 1, hlcStr)
            }
            conn?.commit()
        } catch (e: Exception) {
            conn?.rollback()
            e.printStackTrace()
        } finally {
            conn?.autoCommit = true
        }
        return updated > 0
    }

    @Synchronized
    fun refundTransaction(
        txId: String,
        refundedItems: Map<String, Int>,
        refundAmount: Long
    ): Boolean {
        val hlcStr = hlc.tick()
        conn?.autoCommit = false
        try {
            // Determine if full or partial refund
            var currentStatus = ""
            var currentDetails = ""
            var totalTxAmount = 0L
            conn?.prepareStatement("SELECT status, payment_details, total_minor_units FROM transactions WHERE id = ?")?.use { pstmt ->
                pstmt.setString(1, txId)
                pstmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        currentStatus = rs.getString("status") ?: ""
                        currentDetails = rs.getString("payment_details") ?: ""
                        totalTxAmount = rs.getLong("total_minor_units")
                    }
                }
            }

            // Adjust stock levels and log movements
            refundedItems.forEach { (sku, qtyToReturn) ->
                if (qtyToReturn <= 0) return@forEach
                
                var currentStock = 0
                var colVer = 1L
                conn?.prepareStatement("SELECT stock_level, col_version FROM inventory_catalog WHERE sku = ?")?.use { pstmt ->
                    pstmt.setString(1, sku)
                    pstmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            currentStock = rs.getInt("stock_level")
                            colVer = rs.getLong("col_version")
                        }
                    }
                }
                
                val newStock = currentStock + qtyToReturn
                val newVer = colVer + 1
                val stockHlc = hlc.tick()
                
                conn?.prepareStatement("UPDATE inventory_catalog SET stock_level = ?, col_version = ?, sync_hlc = ? WHERE sku = ?")?.use { pstmt ->
                    pstmt.setInt(1, newStock)
                    pstmt.setLong(2, newVer)
                    pstmt.setString(3, stockHlc)
                    pstmt.setString(4, sku)
                    pstmt.executeUpdate()
                }
                logLocalChange("inventory_catalog", sku, "stock_level", newStock.toString(), newVer, 1, stockHlc)
                addStockMovement(sku, qtyToReturn, "REFUND RETURN (Tx: $txId)")
            }

            val newStatus = "REFUNDED"
            val newDetails = if (currentDetails.isNotEmpty()) {
                "$currentDetails | Refunded ${refundAmount / 100.0}"
            } else {
                "Refunded ${refundAmount / 100.0}"
            }

            conn?.prepareStatement("UPDATE transactions SET status = ?, payment_details = ?, updated_at = ?, sync_hlc = ? WHERE id = ?")?.use { pstmt ->
                pstmt.setString(1, newStatus)
                pstmt.setString(2, newDetails)
                pstmt.setLong(3, System.currentTimeMillis())
                pstmt.setString(4, hlcStr)
                pstmt.setString(5, txId)
                pstmt.executeUpdate()
            }
            logLocalChange("transactions", txId, "status", newStatus, dbVersion + 1, 1, hlcStr)
            logLocalChange("transactions", txId, "payment_details", newDetails, dbVersion + 1, 1, hlcStr)
            
            conn?.commit()
            return true
        } catch (e: Exception) {
            conn?.rollback()
            e.printStackTrace()
            return false
        } finally {
            conn?.autoCommit = true
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ANALYTICS / REPORTING
    // ──────────────────────────────────────────────────────────────────────────

    @Synchronized
    fun getAnalyticsOverview(): AnalyticsOverview {
        var totalRevenueCents = 0L
        var totalTransactions = 0
        var totalItemsSold = 0

        conn?.prepareStatement(
            "SELECT SUM(total_minor_units), COUNT(*) FROM transactions WHERE status = 'COMPLETED' AND is_deleted = 0"
        )?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                if (rs.next()) {
                    totalRevenueCents = rs.getLong(1)
                    totalTransactions = rs.getInt(2)
                }
            }
        }

        conn?.prepareStatement(
            "SELECT SUM(li.quantity) FROM line_items li JOIN transactions t ON li.transaction_id = t.id WHERE t.status = 'COMPLETED' AND t.is_deleted = 0 AND li.is_deleted = 0"
        )?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                if (rs.next()) totalItemsSold = rs.getInt(1)
            }
        }

        val avgOrderValueCents = if (totalTransactions > 0) totalRevenueCents / totalTransactions else 0L
        return AnalyticsOverview(totalRevenueCents, totalTransactions, avgOrderValueCents, totalItemsSold)
    }

    @Synchronized
    fun getDailySales(days: Int = 7): List<DailySalesPoint> {
        val list = mutableListOf<DailySalesPoint>()
        // SQLite: group by date using strftime
        conn?.prepareStatement("""
            SELECT strftime('%m/%d', datetime(created_at / 1000, 'unixepoch', 'localtime')) as day_label,
                   SUM(total_minor_units) as daily_rev
            FROM transactions
            WHERE status = 'COMPLETED' AND is_deleted = 0
              AND created_at >= (strftime('%s', 'now') - ? * 86400) * 1000
            GROUP BY day_label
            ORDER BY day_label ASC
        """)?.use { pstmt ->
            pstmt.setInt(1, days)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(DailySalesPoint(
                        dateLabel = rs.getString("day_label"),
                        revenueCents = rs.getLong("daily_rev")
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun getTopProducts(limit: Int = 10): List<TopProduct> {
        val list = mutableListOf<TopProduct>()
        conn?.prepareStatement("""
            SELECT li.sku,
                   COALESCE(ic.name, li.sku) as pname,
                   SUM(li.quantity) as total_qty,
                   SUM(li.quantity * li.unit_price_minor_units) as total_rev
            FROM line_items li
            JOIN transactions t ON li.transaction_id = t.id
            LEFT JOIN inventory_catalog ic ON li.sku = ic.sku
            WHERE t.status = 'COMPLETED' AND t.is_deleted = 0 AND li.is_deleted = 0
            GROUP BY li.sku
            ORDER BY total_qty DESC
            LIMIT ?
        """)?.use { pstmt ->
            pstmt.setInt(1, limit)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(TopProduct(
                        sku = rs.getString("sku"),
                        name = rs.getString("pname"),
                        unitsSold = rs.getInt("total_qty"),
                        revenueCents = rs.getLong("total_rev")
                    ))
                }
            }
        }
        return list
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  EMPLOYEE MANAGEMENT
    // ──────────────────────────────────────────────────────────────────────────

    data class EmployeeRecord(
        val id: String,
        val role: String,
        val isActive: Boolean
    )

    @Synchronized
    fun getEmployees(): List<EmployeeRecord> {
        val list = mutableListOf<EmployeeRecord>()
        conn?.prepareStatement("SELECT id, role, is_active FROM employees ORDER BY role ASC")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(EmployeeRecord(
                        id = rs.getString("id"),
                        role = rs.getString("role"),
                        isActive = rs.getInt("is_active") == 1
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun addEmployee(role: String, pin: String): String {
        val empId = UUID.randomUUID().toString()
        val hlcStr = hlc.tick()
        val hash = hashPin(pin)
        insertEmployeeDirect(empId, hash, role.uppercase().trim(), hlcStr)
        return empId
    }

    @Synchronized
    fun setEmployeeActive(employeeId: String, active: Boolean): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement("UPDATE employees SET is_active = ?, sync_hlc = ? WHERE id = ?")?.use { pstmt ->
            pstmt.setInt(1, if (active) 1 else 0)
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, employeeId)
            updated = pstmt.executeUpdate()
        }
        return updated > 0
    }

    @Synchronized
    fun changeEmployeePin(employeeId: String, newPin: String): Boolean {
        val hlcStr = hlc.tick()
        val hash = hashPin(newPin)
        var updated = 0
        conn?.prepareStatement("UPDATE employees SET auth_hash = ?, sync_hlc = ? WHERE id = ?")?.use { pstmt ->
            pstmt.setString(1, hash)
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, employeeId)
            updated = pstmt.executeUpdate()
        }
        return updated > 0
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  PREFERENCES
    // ──────────────────────────────────────────────────────────────────────────

    @Synchronized
    fun getPreference(key: String): String? {
        conn?.prepareStatement("SELECT value_payload FROM local_preferences WHERE key = ?")?.use { pstmt ->
            pstmt.setString(1, key)
            pstmt.executeQuery().use { rs ->
                if (rs.next()) return rs.getString(1)
            }
        }
        return null
    }

    @Synchronized
    fun getPreferences(): List<Preference> {
        val list = mutableListOf<Preference>()
        conn?.prepareStatement("SELECT key, value_type, value_payload FROM local_preferences")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(
                        Preference(
                            key = rs.getString("key"),
                            valueType = rs.getString("value_type"),
                            valuePayload = rs.getString("value_payload")
                        )
                    )
                }
            }
        }
        return list
    }

    @Synchronized
    fun setPreference(key: String, type: String, value: String) {
        val now = System.currentTimeMillis()
        val hlcStr = hlc.tick()
        conn?.prepareStatement("""
            INSERT INTO local_preferences (key, value_type, value_payload, is_idempotent_flag, updated_at)
            VALUES (?, ?, ?, 0, ?)
            ON CONFLICT(key) DO UPDATE SET value_payload = excluded.value_payload, updated_at = excluded.updated_at
        """)?.use { pstmt ->
            pstmt.setString(1, key)
            pstmt.setString(2, type)
            pstmt.setString(3, value)
            pstmt.setLong(4, now)
            pstmt.executeUpdate()
        }
        
        // Log changes to CRDT ledger to allow synchronization
        logLocalChange("local_preferences", key, "value_type", type, dbVersion + 1, 1, hlcStr)
        logLocalChange("local_preferences", key, "value_payload", value, dbVersion + 1, 1, hlcStr)
    }

    @Synchronized
    fun getCustomers(): List<Customer> {
        val list = mutableListOf<Customer>()
        conn?.prepareStatement("SELECT * FROM customers ORDER BY name ASC")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(Customer(
                        id = rs.getString("id"),
                        name = rs.getString("name") ?: "",
                        phone = rs.getString("phone") ?: "",
                        email = rs.getString("email") ?: "",
                        totalSpendCents = rs.getLong("total_spend_cents"),
                        visits = rs.getInt("visits"),
                        createdAt = rs.getLong("created_at"),
                        syncHlc = rs.getString("sync_hlc") ?: ""
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun getCustomer(id: String): Customer? {
        conn?.prepareStatement("SELECT * FROM customers WHERE id = ?")?.use { pstmt ->
            pstmt.setString(1, id)
            pstmt.executeQuery().use { rs ->
                if (rs.next()) {
                    return Customer(
                        id = rs.getString("id"),
                        name = rs.getString("name") ?: "",
                        phone = rs.getString("phone") ?: "",
                        email = rs.getString("email") ?: "",
                        totalSpendCents = rs.getLong("total_spend_cents"),
                        visits = rs.getInt("visits"),
                        createdAt = rs.getLong("created_at"),
                        syncHlc = rs.getString("sync_hlc") ?: ""
                    )
                }
            }
        }
        return null
    }

    @Synchronized
    fun addCustomer(name: String, phone: String, email: String): String {
        val id = UUID.randomUUID().toString()
        val hlcStr = hlc.tick()
        val now = System.currentTimeMillis()
        conn?.prepareStatement("""
            INSERT INTO customers (id, name, phone, email, total_spend_cents, visits, created_at, sync_hlc)
            VALUES (?, ?, ?, ?, 0, 0, ?, ?)
        """)?.use { pstmt ->
            pstmt.setString(1, id)
            pstmt.setString(2, name.trim())
            pstmt.setString(3, phone.trim())
            pstmt.setString(4, email.trim())
            pstmt.setLong(5, now)
            pstmt.setString(6, hlcStr)
            pstmt.executeUpdate()
        }
        logLocalChange("customers", id, "name", name.trim(), 1L, 1, hlcStr)
        logLocalChange("customers", id, "phone", phone.trim(), 1L, 1, hlcStr)
        logLocalChange("customers", id, "email", email.trim(), 1L, 1, hlcStr)
        logLocalChange("customers", id, "created_at", now.toString(), 1L, 1, hlcStr)
        return id
    }

    @Synchronized
    fun updateCustomer(id: String, name: String, phone: String, email: String): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement("UPDATE customers SET name = ?, phone = ?, email = ?, sync_hlc = ? WHERE id = ?")?.use { pstmt ->
            pstmt.setString(1, name.trim())
            pstmt.setString(2, phone.trim())
            pstmt.setString(3, email.trim())
            pstmt.setString(4, hlcStr)
            pstmt.setString(5, id)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            logLocalChange("customers", id, "name", name.trim(), dbVersion + 1, 1, hlcStr)
            logLocalChange("customers", id, "phone", phone.trim(), dbVersion + 1, 1, hlcStr)
            logLocalChange("customers", id, "email", email.trim(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun deleteCustomer(id: String): Boolean {
        val hlcStr = hlc.tick()
        var deleted = 0
        conn?.prepareStatement("DELETE FROM customers WHERE id = ?")?.use { pstmt ->
            pstmt.setString(1, id)
            deleted = pstmt.executeUpdate()
        }
        if (deleted > 0) {
            logLocalChange("customers", id, "is_deleted", "1", dbVersion + 1, 0, hlcStr)
        }
        return deleted > 0
    }

    @Synchronized
    fun searchCustomers(query: String): List<Customer> {
        val list = mutableListOf<Customer>()
        val sql = "SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? OR email LIKE ? ORDER BY name ASC LIMIT 50"
        conn?.prepareStatement(sql)?.use { pstmt ->
            val q = "%${query.trim().lowercase()}%"
            pstmt.setString(1, q)
            pstmt.setString(2, q)
            pstmt.setString(3, q)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(Customer(
                        id = rs.getString("id"),
                        name = rs.getString("name") ?: "",
                        phone = rs.getString("phone") ?: "",
                        email = rs.getString("email") ?: "",
                        totalSpendCents = rs.getLong("total_spend_cents"),
                        visits = rs.getInt("visits"),
                        createdAt = rs.getLong("created_at"),
                        syncHlc = rs.getString("sync_hlc") ?: ""
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun updateCustomerStats(customerId: String, spendCents: Long): Boolean {
        val hlcStr = hlc.tick()
        var updated = 0
        conn?.prepareStatement("""
            UPDATE customers SET total_spend_cents = total_spend_cents + ?, visits = visits + ?, sync_hlc = ? WHERE id = ?
        """)?.use { pstmt ->
            pstmt.setLong(1, spendCents)
            pstmt.setInt(2, 1)
            pstmt.setString(3, hlcStr)
            pstmt.setString(4, customerId)
            updated = pstmt.executeUpdate()
        }
        if (updated > 0) {
            var currentSpend = 0L
            var currentVisits = 0
            conn?.prepareStatement("SELECT total_spend_cents, visits FROM customers WHERE id = ?")?.use { pstmt ->
                pstmt.setString(1, customerId)
                pstmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        currentSpend = rs.getLong(1)
                        currentVisits = rs.getInt(2)
                    }
                }
            }
            logLocalChange("customers", customerId, "total_spend_cents", currentSpend.toString(), dbVersion + 1, 1, hlcStr)
            logLocalChange("customers", customerId, "visits", currentVisits.toString(), dbVersion + 1, 1, hlcStr)
        }
        return updated > 0
    }

    @Synchronized
    fun getCategories(): List<String> {
        val list = mutableListOf<String>()
        conn?.prepareStatement("SELECT name FROM categories ORDER BY name ASC")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(rs.getString(1))
                }
            }
        }
        if (!list.contains("Uncategorized")) {
            list.add(0, "Uncategorized")
        }
        return list
    }

    @Synchronized
    fun addCategory(name: String): Boolean {
        val hlcStr = hlc.tick()
        var exists = false
        conn?.prepareStatement("SELECT 1 FROM categories WHERE name = ?")?.use { pstmt ->
            pstmt.setString(1, name.trim())
            pstmt.executeQuery().use { rs -> exists = rs.next() }
        }
        if (exists || name.trim().lowercase() == "uncategorized") return false
        
        conn?.prepareStatement("INSERT INTO categories (name, sync_hlc) VALUES (?, ?)")?.use { pstmt ->
            pstmt.setString(1, name.trim())
            pstmt.setString(2, hlcStr)
            pstmt.executeUpdate()
        }
        logLocalChange("categories", name.trim(), "name", name.trim(), 1L, 1, hlcStr)
        return true
    }

    @Synchronized
    fun deleteCategory(name: String): Boolean {
        val hlcStr = hlc.tick()
        var deleted = 0
        conn?.prepareStatement("DELETE FROM categories WHERE name = ?")?.use { pstmt ->
            pstmt.setString(1, name)
            deleted = pstmt.executeUpdate()
        }
        if (deleted > 0) {
            logLocalChange("categories", name, "is_deleted", "1", dbVersion + 1, 0, hlcStr)
            conn?.prepareStatement("UPDATE inventory_catalog SET category = 'Uncategorized' WHERE category = ?")?.use { pstmt ->
                pstmt.setString(1, name)
                pstmt.executeUpdate()
            }
        }
        return deleted > 0
    }

    @Synchronized
    fun getStockMovements(sku: String): List<StockMovement> {
        val list = mutableListOf<StockMovement>()
        conn?.prepareStatement("SELECT * FROM stock_movements WHERE sku = ? ORDER BY created_at DESC LIMIT 50")?.use { pstmt ->
            pstmt.setString(1, sku)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(StockMovement(
                        id = rs.getString("id"),
                        sku = rs.getString("sku"),
                        changeQty = rs.getInt("change_qty"),
                        reason = rs.getString("reason") ?: "",
                        createdAt = rs.getLong("created_at"),
                        syncHlc = rs.getString("sync_hlc") ?: ""
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun addStockMovement(sku: String, changeQty: Int, reason: String) {
        val id = UUID.randomUUID().toString()
        val hlcStr = hlc.tick()
        val now = System.currentTimeMillis()
        conn?.prepareStatement("""
            INSERT INTO stock_movements (id, sku, change_qty, reason, created_at, sync_hlc)
            VALUES (?, ?, ?, ?, ?, ?)
        """)?.use { pstmt ->
            pstmt.setString(1, id)
            pstmt.setString(2, sku)
            pstmt.setInt(3, changeQty)
            pstmt.setString(4, reason)
            pstmt.setLong(5, now)
            pstmt.setString(6, hlcStr)
            pstmt.executeUpdate()
        }
    }

    @Synchronized
    fun clockIn(employeeId: String): String {
        val id = UUID.randomUUID().toString()
        val hlcStr = hlc.tick()
        val now = System.currentTimeMillis()
        conn?.prepareStatement("INSERT INTO employee_shifts (id, employee_id, clock_in, sync_hlc) VALUES (?, ?, ?, ?)")?.use { pstmt ->
            pstmt.setString(1, id)
            pstmt.setString(2, employeeId)
            pstmt.setLong(3, now)
            pstmt.setString(4, hlcStr)
            pstmt.executeUpdate()
        }
        return id
    }

    @Synchronized
    fun clockOut(employeeId: String): Boolean {
        val hlcStr = hlc.tick()
        val now = System.currentTimeMillis()
        var updated = 0
        conn?.prepareStatement("UPDATE employee_shifts SET clock_out = ?, sync_hlc = ? WHERE employee_id = ? AND clock_out IS NULL")?.use { pstmt ->
            pstmt.setLong(1, now)
            pstmt.setString(2, hlcStr)
            pstmt.setString(3, employeeId)
            updated = pstmt.executeUpdate()
        }
        return updated > 0
    }

    @Synchronized
    fun getActiveShift(employeeId: String): EmployeeShift? {
        conn?.prepareStatement("SELECT * FROM employee_shifts WHERE employee_id = ? AND clock_out IS NULL LIMIT 1")?.use { pstmt ->
            pstmt.setString(1, employeeId)
            pstmt.executeQuery().use { rs ->
                if (rs.next()) {
                    return EmployeeShift(
                        id = rs.getString("id"),
                        employeeId = rs.getString("employee_id"),
                        clockIn = rs.getLong("clock_in"),
                        clockOut = null,
                        syncHlc = rs.getString("sync_hlc") ?: ""
                    )
                }
            }
        }
        return null
    }

    @Synchronized
    fun getEmployeeSalesStats(employeeId: String): Map<String, Long> {
        val stats = mutableMapOf<String, Long>()
        conn?.prepareStatement("""
            SELECT COUNT(*), SUM(total_minor_units) FROM transactions
            WHERE employee_id = ? AND status = 'COMPLETED' AND is_deleted = 0
        """)?.use { pstmt ->
            pstmt.setString(1, employeeId)
            pstmt.executeQuery().use { rs ->
                if (rs.next()) {
                    stats["tx_count"] = rs.getLong(1)
                    stats["total_rev"] = rs.getLong(2)
                }
            }
        }
        return stats
    }

    @Synchronized
    fun getHourlySalesHeatmap(days: Int = 30): List<Map<String, Any>> {
        val list = mutableListOf<Map<String, Any>>()
        conn?.prepareStatement("""
            SELECT strftime('%w', datetime(created_at / 1000, 'unixepoch', 'localtime')) as day_of_week,
                   strftime('%H', datetime(created_at / 1000, 'unixepoch', 'localtime')) as hour_of_day,
                   SUM(total_minor_units) as total_sales,
                   COUNT(*) as tx_count
            FROM transactions
            WHERE status = 'COMPLETED' AND is_deleted = 0
              AND created_at >= (strftime('%s', 'now') - ? * 86400) * 1000
            GROUP BY day_of_week, hour_of_day
        """)?.use { pstmt ->
            pstmt.setInt(1, days)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(mapOf(
                        "day" to rs.getInt("day_of_week"),
                        "hour" to rs.getInt("hour_of_day"),
                        "sales" to rs.getLong("total_sales"),
                        "count" to rs.getInt("tx_count")
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun getCategoryBreakdown(): Map<String, Long> {
        val map = mutableMapOf<String, Long>()
        conn?.prepareStatement("""
            SELECT COALESCE(ic.category, 'Uncategorized') as cat_name,
                   SUM(li.quantity * li.unit_price_minor_units) as total_rev
            FROM line_items li
            JOIN transactions t ON li.transaction_id = t.id
            LEFT JOIN inventory_catalog ic ON li.sku = ic.sku
            WHERE t.status = 'COMPLETED' AND t.is_deleted = 0 AND li.is_deleted = 0
            GROUP BY cat_name
        """)?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    map[rs.getString("cat_name")] = rs.getLong("total_rev")
                }
            }
        }
        return map
    }

    @Synchronized
    fun getTransactionsByDateRange(from: Long, to: Long): List<TransactionRecord> {
        val list = mutableListOf<TransactionRecord>()
        conn?.prepareStatement("""
            SELECT * FROM transactions
            WHERE is_deleted = 0 AND created_at >= ? AND created_at <= ?
            ORDER BY created_at DESC
        """)?.use { pstmt ->
            pstmt.setLong(1, from)
            pstmt.setLong(2, to)
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(TransactionRecord(
                        id = rs.getString("id"),
                        employeeId = rs.getString("employee_id") ?: "",
                        terminalId = rs.getString("terminal_id") ?: "",
                        subtotalMinorUnits = rs.getLong("subtotal_minor_units"),
                        taxMinorUnits = rs.getLong("tax_minor_units"),
                        totalMinorUnits = rs.getLong("total_minor_units"),
                        status = rs.getString("status") ?: "COMPLETED",
                        createdAt = rs.getLong("created_at"),
                        customerId = rs.getString("customer_id"),
                        paymentDetails = rs.getString("payment_details")
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun bootstrap(storeName: String, taxRate: Double, adminPin: String, syncPassphrase: String, theme: String?): Boolean {
        val now = System.currentTimeMillis()
        try {
            setPreference("onboarding_complete", "BOOL", "true")
            setPreference("store_name", "STR", storeName)
            setPreference("store_tax_rate", "STR", taxRate.toString())
            setPreference("store_theme_palette", "STR", theme ?: "Obsidian Emerald")
            setPreference("sync_passphrase", "STR", syncPassphrase)

            // Set admin employee credentials
            val hashed = hashPin(adminPin)
            var adminId: String? = null
            conn?.prepareStatement("SELECT id FROM employees WHERE role = 'ADMIN'")?.use { pstmt ->
                pstmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        adminId = rs.getString(1)
                    }
                }
            }

            val hlcStr = hlc.tick()
            if (adminId != null) {
                conn?.prepareStatement("UPDATE employees SET auth_hash = ?, is_active = 1 WHERE id = ?")?.use { pstmt ->
                    pstmt.setString(1, hashed)
                    pstmt.setString(2, adminId)
                    pstmt.executeUpdate()
                }
                logLocalChange("employees", adminId!!, "auth_hash", hashed, dbVersion + 1, 1, hlcStr)
                logLocalChange("employees", adminId!!, "is_active", "1", dbVersion + 1, 1, hlcStr)
            } else {
                val empId = UUID.randomUUID().toString()
                insertEmployeeDirect(empId, hashed, "ADMIN", hlcStr)
            }
            return true
        } catch (e: Exception) {
            e.printStackTrace()
            return false
        }
    }

    @Synchronized
    fun destructReset(adminPin: String): Boolean {
        val admin = verifyEmployeePin(adminPin)
        if (admin == null || admin.role != "ADMIN") return false
        
        conn?.autoCommit = false
        try {
            conn?.createStatement()?.use { stmt ->
                stmt.execute("DELETE FROM transactions;")
                stmt.execute("DELETE FROM line_items;")
                try { stmt.execute("DELETE FROM speech_analytics_logs;") } catch (e: Exception) {}
                stmt.execute("DELETE FROM crsql_changes;")
                stmt.execute("DELETE FROM stock_movements;")
                stmt.execute("DELETE FROM employee_shifts;")
                stmt.execute("DELETE FROM customers;")
            }
            conn?.commit()
            return true
        } catch (e: Exception) {
            conn?.rollback()
            e.printStackTrace()
            return false
        } finally {
            conn?.autoCommit = true
        }
    }

    @Synchronized
    fun isInitialized(): Boolean {
        try {
            conn?.prepareStatement("SELECT value_payload FROM local_preferences WHERE key = 'onboarding_complete'")?.use { pstmt ->
                pstmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val onboardingComplete = rs.getString("value_payload")
                        if (onboardingComplete != "true") return false
                    } else {
                        return false
                    }
                }
            }
            conn?.prepareStatement("SELECT COUNT(*) as count FROM employees WHERE role = 'ADMIN' AND is_active = 1")?.use { pstmt ->
                pstmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        return rs.getInt("count") > 0
                    }
                }
            }
            return false
        } catch (e: Exception) {
            e.printStackTrace()
            return false
        }
    }

    @Synchronized
    fun factoryReset(): Boolean {
        conn?.autoCommit = false
        try {
            conn?.createStatement()?.use { stmt ->
                val tables = listOf(
                    "transactions", "line_items", "inventory_catalog", "employees",
                    "crsql_changes", "speech_analytics_logs", "local_preferences",
                    "customers", "categories", "stock_movements", "employee_shifts",
                    "approved_devices", "distributors", "purchase_orders", "po_line_items",
                    "distributor_payments", "customer_credit", "fbr_submissions",
                    "aborted_sales_log", "telemetry_logs"
                )
                for (table in tables) {
                    try { stmt.execute("DELETE FROM $table;") } catch (e: Exception) {}
                }
            }
            conn?.commit()
            return true
        } catch (e: Exception) {
            conn?.rollback()
            e.printStackTrace()
            return false
        } finally {
            conn?.autoCommit = true
        }
    }

    @Synchronized
    fun addSpeechLog(
        id: String,
        transactionId: String?,
        duration: Long,
        tag: String,
        fillerWords: Int,
        sentiment: String,
        flagged: Boolean,
        markers: String
    ): Boolean {
        val hlcStr = hlc.tick()
        return try {
            conn?.prepareStatement("""
                INSERT INTO speech_analytics_logs (id, transaction_id, utterance_duration_ms, speaker_diarization_tag, filler_word_count, sentiment_score, flagged_fraud_risk, disfluency_markers, sync_hlc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """)?.use { pstmt ->
                pstmt.setString(1, id)
                pstmt.setString(2, transactionId)
                pstmt.setLong(3, duration)
                pstmt.setString(4, tag)
                pstmt.setInt(5, fillerWords)
                pstmt.setString(6, sentiment)
                pstmt.setInt(7, if (flagged) 1 else 0)
                pstmt.setString(8, markers)
                pstmt.setString(9, hlcStr)
                pstmt.executeUpdate()
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    @Serializable
    data class DeviceRecord(
        val nodeId: String,
        val deviceName: String,
        val userAgent: String,
        val approvedAt: Long?,
        val status: String
    )

    @Synchronized
    fun getDeviceStatus(nodeId: String): String? {
        conn?.prepareStatement("SELECT status FROM approved_devices WHERE node_id = ?")?.use { pstmt ->
            pstmt.setString(1, nodeId)
            pstmt.executeQuery().use { rs ->
                if (rs.next()) return rs.getString(1)
            }
        }
        return null
    }

    @Synchronized
    fun addPendingDevice(nodeId: String, name: String?, userAgent: String?) {
        conn?.prepareStatement("""
            INSERT OR IGNORE INTO approved_devices (node_id, device_name, user_agent, approved_at, status)
            VALUES (?, ?, ?, NULL, 'PENDING')
        """)?.use { pstmt ->
            pstmt.setString(1, nodeId)
            pstmt.setString(2, name ?: "Unknown Device")
            pstmt.setString(3, userAgent ?: "Unknown User Agent")
            pstmt.executeUpdate()
        }
    }

    @Synchronized
    fun approveDevice(nodeId: String): Boolean {
        conn?.prepareStatement("UPDATE approved_devices SET status = 'APPROVED', approved_at = ? WHERE node_id = ?")?.use { pstmt ->
            pstmt.setLong(1, System.currentTimeMillis())
            pstmt.setString(2, nodeId)
            return pstmt.executeUpdate() > 0
        }
        return false
    }

    @Synchronized
    fun rejectDevice(nodeId: String): Boolean {
        conn?.prepareStatement("DELETE FROM approved_devices WHERE node_id = ?")?.use { pstmt ->
            pstmt.setString(1, nodeId)
            return pstmt.executeUpdate() > 0
        }
        return false
    }

    @Synchronized
    fun getPendingDevices(): List<DeviceRecord> {
        val list = mutableListOf<DeviceRecord>()
        conn?.prepareStatement("SELECT * FROM approved_devices WHERE status = 'PENDING'")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(DeviceRecord(
                        nodeId = rs.getString("node_id"),
                        deviceName = rs.getString("device_name") ?: "",
                        userAgent = rs.getString("user_agent") ?: "",
                        approvedAt = if (rs.getObject("approved_at") != null) rs.getLong("approved_at") else null,
                        status = rs.getString("status") ?: "PENDING"
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun getAllDevices(): List<DeviceRecord> {
        val list = mutableListOf<DeviceRecord>()
        conn?.prepareStatement("SELECT * FROM approved_devices")?.use { pstmt ->
            pstmt.executeQuery().use { rs ->
                while (rs.next()) {
                    list.add(DeviceRecord(
                        nodeId = rs.getString("node_id"),
                        deviceName = rs.getString("device_name") ?: "",
                        userAgent = rs.getString("user_agent") ?: "",
                        approvedAt = if (rs.getObject("approved_at") != null) rs.getLong("approved_at") else null,
                        status = rs.getString("status") ?: "PENDING"
                    ))
                }
            }
        }
        return list
    }

    @Synchronized
    fun submitPaymentProof(
        id: String,
        userId: String,
        planId: String,
        rrnReference: String,
        amount: Double,
        proofImageUrl: String
    ): Boolean {
        return try {
            conn?.prepareStatement("""
                INSERT INTO payment_proofs (id, user_id, plan_id, rrn_reference, amount, proof_image_url, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """)?.use { pstmt ->
                pstmt.setString(1, id)
                pstmt.setString(2, userId)
                pstmt.setString(3, planId)
                pstmt.setString(4, rrnReference)
                pstmt.setDouble(5, amount)
                pstmt.setString(6, proofImageUrl)
                pstmt.setLong(7, System.currentTimeMillis())
                pstmt.setLong(8, System.currentTimeMillis())
                pstmt.executeUpdate()
            }
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }
}

