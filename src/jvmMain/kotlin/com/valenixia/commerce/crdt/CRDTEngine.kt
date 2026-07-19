package com.valenixia.commerce.crdt

import java.util.UUID
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.max

@Serializable
data class SyncChange(
    @SerialName("table_name") val tableName: String,
    val pk: String,
    val cid: String,
    @SerialName("val") val value: String?,
    @SerialName("col_version") val colVersion: Long,
    @SerialName("db_version") val dbVersion: Long,
    @SerialName("site_id") val siteId: String,
    val cl: Int, // causal length (1 for active, 0 for tombstone/delete)
    @SerialName("sync_hlc") val syncHlc: String
)

class HLC(val nodeId: String = UUID.randomUUID().toString().substring(0, 8)) {
    var l: Long = 0L // Physical clock component
    var c: Int = 0   // Logical counter component

    @Synchronized
    fun tick(): String {
        val physical = System.currentTimeMillis()
        if (physical > l) {
            l = physical
            c = 0
        } else {
            c += 1
        }
        return toStringRepresentation()
    }

    @Synchronized
    fun merge(remoteHlcStr: String): String {
        val physical = System.currentTimeMillis()
        val remote = parse(remoteHlcStr)
        val driftLimitMs = 300000L
        val adjustedRemoteL = if (remote.l - physical > driftLimitMs) {
            System.err.println("[HLC] WARNING: Clamping remote clock timestamp $remoteHlcStr due to future drift (>5m)")
            physical
        } else {
            remote.l
        }
        val maxL = max(max(l, adjustedRemoteL), physical)

        if (maxL == l && maxL == adjustedRemoteL) {
            c = max(c, remote.c) + 1
        } else if (maxL == adjustedRemoteL) {
            c = remote.c + 1
        } else if (maxL == l) {
            c += 1
        } else {
            c = 0
        }
        l = maxL
        return toStringRepresentation()
    }

    private fun toStringRepresentation(): String {
        return "${l.toString().padStart(15, '0')}:${c.toString().padStart(6, '0')}:$nodeId"
    }

    companion object {
        fun parse(hlcStr: String): ParsedHlc {
            val parts = hlcStr.split(":")
            if (parts.size < 3) throw IllegalArgumentException("Invalid HLC string: $hlcStr")
            return ParsedHlc(
                l = parts[0].toLong(),
                c = parts[1].toInt(),
                nodeId = parts.slice(2 until parts.size).joinToString(":")
            )
        }

        fun compare(hlc1: String, hlc2: String): Int {
            return hlc1.compareTo(hlc2)
        }
    }
}

data class ParsedHlc(val l: Long, val c: Int, val nodeId: String)

fun shouldApplyDelta(local: SyncChange?, incoming: SyncChange): Boolean {
    if (local == null) return true // No local change exists, apply it
    
    // LWW (Last-Write-Wins) comparison based on colVersion first, then syncHlc timestamp
    if (incoming.colVersion > local.colVersion) return true
    if (incoming.colVersion < local.colVersion) return false
    
    return HLC.compare(incoming.syncHlc, local.syncHlc) > 0
}
