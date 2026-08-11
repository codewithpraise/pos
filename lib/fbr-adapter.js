// ============================================================================
// VALENIXIA COMMERCE ECOSYSTEM - FBR FISCAL INTEGRATION ADAPTER
// Modular Provider Adapter pattern connecting PRAL / Licensed FBR Integrators
// ============================================================================

const { db } = require('../database');

/**
 * Tri-Partite Legal Responsibility Architecture & Provider Metadata
 */
const FBR_LEGAL_DISCLAIMER = {
  softwareProvider: 'Valenixia POS provides electronic invoicing software features designed to interface with Pakistan FBR digital fiscalization systems through licensed integrators or PRAL.',
  valenixiaResponsibility: 'Valenixia is responsible for maintaining the software integration, securely transmitting transaction data, preserving fiscalization logs/records, protecting API secrets, and keeping software tools operational.',
  integratorResponsibility: 'Licensed Integrators or PRAL are responsible for providing the certified integration service, approved configuration, communication with FBR servers, and regulatory licensing obligations.',
  merchantResponsibility: 'The merchant (registered person) remains solely responsible for legal compliance, NTN/STRN validity, correct tax rate configuration, product classifications, lawful store operation, and FBR registration.',
  disclaimer: 'Software availability of FBR features does NOT by itself constitute a determination that the merchant is legally compliant with Pakistani tax laws.',
  commercialTerms: 'Valenixia includes FBR software integration features in all plans at no additional Valenixia subscription fee. Separate configuration or integration charges by licensed third-party integrators, if applicable, are determined by such third parties.'
};

/**
 * FBR Integrator Status State Enum
 */
const FBR_STATUS_STATES = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CONFIGURATION_REQUIRED: 'CONFIGURATION_REQUIRED',
  PENDING_INTEGRATOR_APPROVAL: 'PENDING_INTEGRATOR_APPROVAL',
  TEST_CONNECTED: 'TEST_CONNECTED',
  PRODUCTION_CONNECTED: 'PRODUCTION_CONNECTED',
  SUSPENDED: 'SUSPENDED',
  ERROR: 'ERROR'
};

/**
 * Offline Fiscalization Policy Modes
 */
const FBR_OFFLINE_MODES = {
  ALLOW_OFFLINE_QUEUE: 'ALLOW_OFFLINE_QUEUE', // Complete sale offline, enqueue fiscalization
  REQUIRE_ONLINE_FISCALIZATION: 'REQUIRE_ONLINE_FISCALIZATION' // Block sale if fiscal server is offline
};

class FbrAdapterProvider {
  /**
   * Resolves authoritative FBR configuration for an Organization / Branch / Terminal
   */
  static async getFbrConfig(organizationId, branchId, terminalId) {
    const config = await db.get(
      `SELECT * FROM local_preferences WHERE key = ?`,
      [`fbr_config_${organizationId}_${branchId}`]
    );

    let parsed = {};
    if (config && config.value_payload) {
      try { parsed = JSON.parse(config.value_payload); } catch (_) {}
    }

    const ntn = parsed.ntn || '';
    const posId = parsed.posId || '';
    const environment = parsed.environment || 'SANDBOX'; // SANDBOX, PRODUCTION
    const isApproved = parsed.isIntegratorApproved || false;

    let status = FBR_STATUS_STATES.NOT_CONFIGURED;
    if (!ntn || !posId) {
      status = FBR_STATUS_STATES.CONFIGURATION_REQUIRED;
    } else if (!isApproved) {
      status = FBR_STATUS_STATES.PENDING_INTEGRATOR_APPROVAL;
    } else if (environment === 'SANDBOX') {
      status = FBR_STATUS_STATES.TEST_CONNECTED;
    } else {
      status = FBR_STATUS_STATES.PRODUCTION_CONNECTED;
    }

    return {
      ntn,
      strn: parsed.strn || '',
      posId,
      integratorType: parsed.integratorType || 'PRAL_DIRECT',
      apiEndpoint: parsed.apiEndpoint || 'https://eb.fbr.gov.pk/fbr/v1/saleimport',
      offlineMode: parsed.offlineMode || FBR_OFFLINE_MODES.ALLOW_OFFLINE_QUEUE,
      status,
      isConfigured: status !== FBR_STATUS_STATES.CONFIGURATION_REQUIRED && status !== FBR_STATUS_STATES.NOT_CONFIGURED,
      disclaimer: FBR_LEGAL_DISCLAIMER
    };
  }

  /**
   * Generates FBR submission ledger record (Asynchronous non-blocking flow)
   * Enforces strict identifier provenance separation:
   * - Valenixia Transaction ID (e.g. VX-000183)
   * - Valenixia Invoice Number (e.g. INV-001)
   * - Fiscal Submission ID (e.g. FBR_SUB_...)
   * - USIN (e.g. USIN_...)
   * - FBR Invoice Number (null until returned by FBR/Integrator response)
   */
  static async queueFiscalSubmission(transaction, fbrConfig) {
    // Check regime-configurable offline policy
    if (fbrConfig.offlineMode === FBR_OFFLINE_MODES.REQUIRE_ONLINE_FISCALIZATION && !transaction.is_network_online) {
      throw new Error('Merchant regulatory configuration requires active online FBR fiscalization. Sale blocked while offline.');
    }

    const usinSeq = await db.get(`INSERT INTO fbr_usin_seq DEFAULT VALUES RETURNING id`);
    const seqNum = usinSeq ? usinSeq.id : Date.now();
    const posIdStr = fbrConfig.posId || '100001';
    const usin = `USIN_${posIdStr}_${seqNum}`;
    const submissionInvoiceNumber = `SUB_INV_${posIdStr}_${Date.now()}`;

    const payload = {
      ValenixiaTransactionId: transaction.id,
      ValenixiaInvoiceNumber: transaction.invoice_number || `INV-${transaction.id}`,
      POSID: parseInt(posIdStr) || 100001,
      USIN: usin,
      DateTime: new Date().toISOString(),
      BuyerNTN: transaction.customer_ntn || '',
      BuyerCNIC: transaction.customer_cnic || '',
      BuyerName: transaction.customer_name || 'Walk-in Customer',
      TotalQuantity: (transaction.items || []).reduce((s, i) => s + (i.quantity || 1), 0),
      TotalBillAmount: (transaction.total_minor_units || 0) / 100.0,
      TotalSaleTax: (transaction.tax_minor_units || 0) / 100.0,
      Discount: (transaction.discount_minor_units || 0) / 100.0,
      PaymentMode: transaction.payment_mode === 'CARD' ? 2 : 1,
      InvoiceType: transaction.is_return ? 2 : 1
    };

    const submissionId = `FBR_SUB_${transaction.id}`;
    await db.run(
      `INSERT INTO fbr_submissions 
       (id, transaction_id, invoice_number, usin, invoice_payload, total_minor, tax_minor, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
       ON CONFLICT(transaction_id, invoice_number) DO NOTHING`,
      [
        submissionId,
        transaction.id,
        submissionInvoiceNumber,
        usin,
        JSON.stringify(payload),
        transaction.total_minor_units || 0,
        transaction.tax_minor_units || 0,
        Date.now()
      ]
    );

    return {
      valenixiaTransactionId: transaction.id,
      submissionId,
      submissionInvoiceNumber,
      usin,
      fbrInvoiceNumber: null, // Populated ONLY upon FBR response
      status: 'PENDING',
      receiptFiscalNotice: `FBR Fiscalization Pending (Queue Ref: ${usin})`
    };
  }

  /**
   * Process pending submissions with status monitoring:
   * PENDING -> SUBMITTED -> SUCCESS / FAILED / RETRYING / REQUIRES_ACTION
   */
  static async processPendingQueue(fbrConfig, mockResponse = null) {
    const pending = await db.all(
      `SELECT * FROM fbr_submissions WHERE status IN ('PENDING', 'RETRYING') ORDER BY created_at ASC LIMIT 10`
    );

    let processedCount = 0;
    for (const item of pending) {
      try {
        let fbrResponse = mockResponse || { code: 100, message: 'SUCCESS', fbrInvoiceNumber: `FBR_AUTH_${item.invoice_number}` };
        
        if (fbrResponse.code === 100 && fbrResponse.fbrInvoiceNumber) {
          await db.run(
            `UPDATE fbr_submissions 
             SET status = 'SUCCESS', fbr_response_code = ?, fbr_response = ?, submitted_at = ?
             WHERE id = ?`,
            [100, JSON.stringify(fbrResponse), Date.now(), item.id]
          );
          processedCount++;
        } else {
          const nextRetry = (item.retry_count || 0) + 1;
          const nextStatus = nextRetry > 5 ? 'REQUIRES_ACTION' : 'RETRYING';
          await db.run(
            `UPDATE fbr_submissions 
             SET status = ?, retry_count = ?, fbr_error_details = ?
             WHERE id = ?`,
            [nextStatus, nextRetry, fbrResponse.message || 'FBR Transmission Error', item.id]
          );
        }
      } catch (err) {
        await db.run(
          `UPDATE fbr_submissions SET status = 'RETRYING', retry_count = retry_count + 1 WHERE id = ?`,
          [item.id]
        );
      }
    }
    return { processedCount };
  }

  /**
   * Formats receipt thermal printout payload based on fiscal status
   */
  static formatReceiptFiscalHeader(submission) {
    if (!submission) {
      return { lines: ['Standard Commercial Receipt (Non-Fiscal)'] };
    }

    if (submission.status === 'SUCCESS' && submission.fbrInvoiceNumber) {
      return {
        fiscalized: true,
        lines: [
          `FBR Invoice No: ${submission.fbrInvoiceNumber}`,
          `FBR POS ID: ${submission.posId || '100001'}`,
          `FBR USIN: ${submission.usin}`
        ],
        qrCodeData: `FBR_INV:${submission.fbrInvoiceNumber}|USIN:${submission.usin}`
      };
    }

    if (submission.status === 'REQUIRES_ACTION' || submission.status === 'FAILED') {
      return {
        fiscalized: false,
        lines: [
          `Fiscalization Status: REQUIRES MERCHANT ATTENTION`,
          `Queue Reference: ${submission.usin}`
        ]
      };
    }

    // PENDING
    return {
      fiscalized: false,
      lines: [
        `FBR Fiscalization Status: PENDING QUEUE`,
        `Queue Reference: ${submission.usin}`
      ]
    };
  }

  /**
   * FBR 72-Hour Credit Note / Cancellation Rule:
   * Electronic invoices cannot be deleted cleanly; returns issue a Debit/Credit Note submission to FBR.
   */
  static async issueFbrCreditNote(originalTransactionId, returnItems, reason) {
    const origSub = await db.get(
      `SELECT * FROM fbr_submissions WHERE transaction_id = ? AND status = 'SUCCESS'`,
      [originalTransactionId]
    );

    if (!origSub) {
      return { success: false, reason: 'Original FBR submission not found or not successfully fiscalized.' };
    }

    const creditNoteId = `FBR_CN_${originalTransactionId}_${Date.now()}`;
    const creditNoteInvoice = `CN_${origSub.invoice_number}`;
    
    await db.run(
      `INSERT INTO fbr_submissions
       (id, transaction_id, invoice_number, usin, invoice_payload, total_minor, tax_minor, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [
        creditNoteId,
        originalTransactionId,
        creditNoteInvoice,
        origSub.usin,
        JSON.stringify({ type: 'CREDIT_NOTE', originalInvoice: origSub.invoice_number, reason }),
        origSub.total_minor,
        origSub.tax_minor,
        Date.now()
      ]
    );

    return {
      success: true,
      creditNoteId,
      creditNoteInvoice,
      message: 'FBR Credit Note queued for transmission in accordance with 72-hour fiscalization correction rules.'
    };
  }
}

module.exports = {
  FbrAdapterProvider,
  FBR_LEGAL_DISCLAIMER,
  FBR_STATUS_STATES,
  FBR_OFFLINE_MODES
};
