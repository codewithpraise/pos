// ============================================================================
// VALENIXIA — EMVCo Merchant-Presented Mode (MPM) QR Generator
// Compliant with: SBP Interoperable QR Standard, EMVCo QR Code Specification v1.1
// For Pakistan (PKR, ISO 4217: 586), Country Code: PK
// Supports: JazzCash, EasyPaisa, Raast, and any EMVCo-compliant wallet app
// ============================================================================
(function() {
  'use strict';

  // TLV (Tag-Length-Value) Builder
  function tlv(id, value) {
    const v = String(value || '');
    const len = String(v.length).padStart(2, '0');
    return String(id).padStart(2, '0') + len + v;
  }

  // CRC-16/CCITT-FALSE: Polynomial 0x1021, Init 0xFFFF, No reflect
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= (str.charCodeAt(i) << 8);
      for (let j = 0; j < 8; j++) {
        if (crc & 0x8000) { crc = ((crc << 1) ^ 0x1021) & 0xFFFF; }
        else { crc = (crc << 1) & 0xFFFF; }
      }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }

  function buildEMVCoPayload({ amount, merchantName, merchantCity, tillId, walletType, referenceLabel, mcc }) {
    const isDynamic = !!amount && parseFloat(amount) > 0;
    const safeName = String(merchantName || 'VALENIXIA POS').substring(0, 25).toUpperCase();
    const safeCity = String(merchantCity || 'PAKISTAN').substring(0, 15).toUpperCase();
    const safeRef  = String(referenceLabel || '').substring(0, 25);
    const safeMCC  = String(mcc || '5999').substring(0, 4);
    let guid = 'com.valenixia.pos.qr';
    if (walletType === 'jazzcash') guid = 'com.jazzcash.merchantqr';
    else if (walletType === 'easypaisa') guid = 'com.easypaisa.merchantqr';
    else if (walletType === 'raast') guid = 'com.sbp.raast.p2m';
    let merchantAccountInfo = tlv('00', guid);
    if (tillId && tillId.trim()) merchantAccountInfo += tlv('01', tillId.trim().substring(0, 32));
    const merchantAccountBlock = tlv('26', merchantAccountInfo);
    let additionalData = safeRef ? tlv('62', tlv('05', safeRef)) : '';
    let payload = '';
    payload += tlv('00', '01');
    payload += tlv('01', isDynamic ? '12' : '11');
    payload += merchantAccountBlock;
    payload += tlv('52', safeMCC);
    payload += tlv('53', '586');
    if (isDynamic) payload += tlv('54', parseFloat(amount).toFixed(2));
    payload += tlv('58', 'PK');
    payload += tlv('59', safeName);
    payload += tlv('60', safeCity);
    if (additionalData) payload += additionalData;
    const payloadForCRC = payload + '6304';
    payload = payloadForCRC + crc16(payloadForCRC);
    return payload;
  }

  function renderEMVCoQR(container, opts, size) {
    if (!container) return null;
    const qrSize = size || 192;
    container.replaceChildren();
    try {
      const payload = buildEMVCoPayload(opts);
      if (typeof QRCode === 'undefined') {
        container.innerHTML = '<div style="color:#ef4444;font-size:11px;text-align:center;padding:8px;">QR library not loaded</div>';
        return null;
      }
      new QRCode(container, { text: payload, width: qrSize, height: qrSize, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
      return payload;
    } catch (err) {
      container.innerHTML = '<div style="color:#ef4444;font-size:11px;text-align:center;padding:8px;">QR error: ' + err.message + '</div>';
      return null;
    }
  }

  function getMerchantQRConfig() {
    const prefs = (window.__valenixiaState && window.__valenixiaState.preferences) || {};
    return {
      merchantName: prefs.store_name || 'VALENIXIA POS',
      merchantCity: prefs.store_city || 'PAKISTAN',
      tillId:        prefs.qr_till_id || '',
      walletType:    prefs.qr_wallet_type || 'generic',
      mcc:           prefs.qr_mcc || '5999',
      customQrImage: prefs.custom_bank_qr_image || ''
    };
  }

  window.EMVCoQR = { buildPayload: buildEMVCoPayload, render: renderEMVCoQR, getMerchantConfig: getMerchantQRConfig, crc16: crc16 };
})();
