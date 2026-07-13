#!/bin/bash
# ============================================================================
# VALENIXIA POS - Pre-commit git hook to check for SQL injection patterns
# ============================================================================

# Search staging area for template literals inside database query execution functions
BAD_PATTERNS=$(git diff --cached --name-only | grep '\.js$' | xargs grep -E "db\.(get|run|all)\(.*\$\{" 2>/dev/null)

if [ ! -z "$BAD_PATTERNS" ]; then
    echo "❌ ERROR: Detected potential SQL injection pattern (template literal inside db query):"
    echo "$BAD_PATTERNS"
    echo "Please parameterize variables using placeholder array arguments instead of template literals."
    exit 1
fi

exit 0
