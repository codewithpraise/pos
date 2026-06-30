package com.nexova.commerce.audio

import javax.sound.sampled.AudioFormat
import javax.sound.sampled.AudioSystem
import kotlin.math.sin

object AudioSynth {
    fun playBeep(frequency: Float, durationMs: Int, volume: Double = 0.5) {
        Thread {
            try {
                val sampleRate = 8000f
                val numSamples = (durationMs * (sampleRate / 1000f)).toInt()
                val buffer = ByteArray(numSamples)
                for (i in 0 until numSamples) {
                    val angle = 2.0 * Math.PI * i / (sampleRate / frequency)
                    buffer[i] = (sin(angle) * 127 * volume).toInt().toByte()
                }
                val format = AudioFormat(sampleRate, 8, 1, true, true)
                val line = AudioSystem.getSourceDataLine(format)
                line.open(format)
                line.start()
                line.write(buffer, 0, buffer.size)
                line.drain()
                line.close()
            } catch (e: Exception) {
                println("[AudioSynth] Error playing frequency $frequency: ${e.message}")
            }
        }.start()
    }

    fun playScanSuccess() {
        playBeep(1000f, 50, 0.4)
        Thread.sleep(45)
        playBeep(1400f, 70, 0.4)
    }

    fun playScanError() {
        playBeep(130f, 220, 0.6)
    }

    fun playTick() {
        playBeep(1800f, 8, 0.1)
    }

    fun playDrawerOpen() {
        playBeep(880f, 150, 0.3)
        Thread.sleep(80)
        playBeep(1320f, 250, 0.3)
    }
}
