// Centralized Licensing Configuration & Limits Specification
const LICENSE_CONFIG = {
  STARTER:    { allowedTerminals: 1, devices: 1, trialDays: 7, name: 'Starter Tier' },
  GROWTH:     { allowedTerminals: 2, devices: 2, trialDays: 7, name: 'Growth Tier' },
  PRO:        { allowedTerminals: 2, devices: 3, trialDays: 7, name: 'Pro Tier' },
  ENTERPRISE: { allowedTerminals: 4, devices: 5, trialDays: 7, name: 'Enterprise Tier' },
  TRIAL:      { allowedTerminals: 4, devices: 5, trialDays: 7, name: 'Free Trial' }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = LICENSE_CONFIG;
} else if (typeof window !== 'undefined') {
  window.LICENSE_CONFIG = LICENSE_CONFIG;
}
