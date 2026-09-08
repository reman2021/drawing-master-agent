export const QUALITY_PROFILES = Object.freeze(["standard", "showcase"]);

export function normalizeQualityProfile(value = "standard") {
  const profile = String(value ?? "standard").toLowerCase();
  if (!QUALITY_PROFILES.includes(profile)) {
    const error = new Error(`Quality profile must be one of: ${QUALITY_PROFILES.join(", ")}.`);
    error.code = "quality.profile";
    throw error;
  }
  return profile;
}

export function normalizeDiagnostic(input, fallbackSeverity = "error") {
  const item = input && typeof input === "object" ? input : { message: String(input) };
  const identity = item.elementId == null ? null : { kind: "element", id: String(item.elementId) };
  return {
    ...item,
    code: String(item.code ?? "runtime.unknown"),
    severity: item.severity ?? fallbackSeverity,
    message: String(item.message ?? "Unknown diagnostic."),
    subject: item.subject ?? { path: null, identity },
    evidence: item.evidence ?? (item.elementId == null ? {} : { elementId: String(item.elementId) }),
    supportedFixes: Array.isArray(item.supportedFixes) ? item.supportedFixes : [],
  };
}

export function qualityReport(errors = [], warnings = [], options = {}) {
  const profile = normalizeQualityProfile(options.profile);
  const normalizedErrors = errors.map((item) => normalizeDiagnostic(item, "error"));
  const normalizedWarnings = warnings.map((item) => normalizeDiagnostic(item, "warning"));
  let reportedWarnings = normalizedWarnings;
  if (profile === "showcase") {
    const promoted = normalizedWarnings.filter((item) => /^(?:geometry|visual)\./u.test(item.code));
    normalizedErrors.push(...promoted.map((item) => ({ ...item, severity: "error" })));
    const promotedSet = new Set(promoted);
    reportedWarnings = normalizedWarnings.filter((item) => !promotedSet.has(item));
  }
  const diagnostics = [...normalizedErrors, ...reportedWarnings];
  return {
    valid: normalizedErrors.length === 0,
    profile,
    errors: normalizedErrors,
    warnings: reportedWarnings,
    diagnostics,
    summary: {
      errors: normalizedErrors.length,
      warnings: reportedWarnings.length,
    },
  };
}
