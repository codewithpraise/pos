// Centralized Licensing Configuration & Limits Specification
const LICENSE_CONFIG = {
  FREE:       { allowedTerminals: 1, devices: 1, maxProducts: 25,  monthlyTx: 100,      trialDays: 7, name: 'Free Basic Tier' },
  STARTER:    { allowedTerminals: 1, devices: 1, maxProducts: 500, monthlyTx: Infinity, trialDays: 7, name: 'Starter Tier' },
  GROWTH:     { allowedTerminals: 2, devices: 2, maxProducts: Infinity, monthlyTx: Infinity, trialDays: 7, name: 'Growth Tier' },
  PRO:        { allowedTerminals: 2, devices: 3, maxProducts: Infinity, monthlyTx: Infinity, trialDays: 7, name: 'Pro Tier' },
  ENTERPRISE: { allowedTerminals: 4, devices: 5, maxProducts: Infinity, monthlyTx: Infinity, trialDays: 7, name: 'Enterprise Tier' },
  TRIAL:      { allowedTerminals: 4, devices: 5, maxProducts: Infinity, monthlyTx: Infinity, trialDays: 7, name: 'Free Trial' }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LICENSE_CONFIG;
} else if (typeof window !== 'undefined') {
  window.LICENSE_CONFIG = LICENSE_CONFIG;
}
