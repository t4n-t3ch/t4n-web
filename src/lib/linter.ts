// t4n-web/src/lib/linter.ts
// Browser-side linter for Pine Script (and basic checks for other domains)

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type Diagnostic = {
    line: number;       // 1-based
    col: number;        // 1-based
    endCol: number;     // 1-based
    severity: DiagnosticSeverity;
    message: string;
    code: string;       // rule id e.g. "PS001"
    quickFix?: {
        label: string;
        replacement: string;    // full replacement for that line
    };
};

type LintRule = {
    code: string;
    severity: DiagnosticSeverity;
    check: (line: string, lineIndex: number, allLines: string[]) => Diagnostic | null;
};

// ─── Pine Script Rules ────────────────────────────────────────────────────────

const PINE_RULES: LintRule[] = [
    // PS001 — missing //@version=
    {
        code: 'PS001',
        severity: 'error',
        check: (_line, lineIndex, allLines) => {
            if (lineIndex !== 0) return null;
            const hasVersion = allLines.some(l => /^\s*\/\/@version=\d+/.test(l));
            if (!hasVersion) {
                return {
                    line: 1, col: 1, endCol: 1,
                    severity: 'error',
                    message: 'Missing //@version=5 declaration. Pine Script files must start with a version tag.',
                    code: 'PS001',
                    quickFix: { label: 'Add //@version=5', replacement: '//@version=5' },
                };
            }
            return null;
        },
    },

    // PS002 — deprecated version (v3/v4 style)
    {
        code: 'PS002',
        severity: 'warning',
        check: (line, lineIndex) => {
            const m = line.match(/^\s*\/\/@version=([1-4])\s*$/);
            if (!m) return null;
            return {
                line: lineIndex + 1, col: 1, endCol: line.length + 1,
                severity: 'warning',
                message: `Pine Script v${m[1]} is outdated. Upgrade to //@version=5.`,
                code: 'PS002',
                quickFix: { label: 'Upgrade to //@version=5', replacement: '//@version=5' },
            };
        },
    },

    // PS003 — use of study() instead of indicator()
    {
        code: 'PS003',
        severity: 'warning',
        check: (line, lineIndex) => {
            if (!/\bstudy\s*\(/.test(line)) return null;
            const col = line.indexOf('study') + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 5,
                severity: 'warning',
                message: '`study()` is deprecated in Pine Script v5. Use `indicator()` instead.',
                code: 'PS003',
                quickFix: {
                    label: 'Replace study() with indicator()',
                    replacement: line.replace(/\bstudy\s*\(/, 'indicator('),
                },
            };
        },
    },

    // PS004 — security() instead of request.security()
    {
        code: 'PS004',
        severity: 'warning',
        check: (line, lineIndex) => {
            if (!/\bsecurity\s*\(/.test(line) || /request\.security/.test(line)) return null;
            const col = line.indexOf('security') + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 8,
                severity: 'warning',
                message: '`security()` is deprecated. Use `request.security()` in Pine Script v5.',
                code: 'PS004',
                quickFix: {
                    label: 'Replace with request.security()',
                    replacement: line.replace(/\bsecurity\s*\(/, 'request.security('),
                },
            };
        },
    },

    // PS005 — nz() usage (still valid but flag as info)
    {
        code: 'PS005',
        severity: 'info',
        check: (line, lineIndex) => {
            if (!/\bnz\s*\(/.test(line)) return null;
            const col = line.indexOf('nz') + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 2,
                severity: 'info',
                message: '`nz()` is valid but consider `na(x) ? default : x` for clarity in v5.',
                code: 'PS005',
            };
        },
    },

    // PS006 — bare `if` with no condition on same line
    {
        code: 'PS006',
        severity: 'error',
        check: (line, lineIndex) => {
            if (!/^\s*if\s*$/.test(line)) return null;
            return {
                line: lineIndex + 1, col: line.indexOf('if') + 1, endCol: line.indexOf('if') + 3,
                severity: 'error',
                message: '`if` statement has no condition.',
                code: 'PS006',
            };
        },
    },

    // PS007 — var declaration with type annotation (v5 style check)
    {
        code: 'PS007',
        severity: 'info',
        check: (line, lineIndex) => {
            // Catches `var int x = ` style — valid but flag as info for awareness
            if (!/^\s*var\s+(int|float|bool|string|color|label|line|box)\s+\w+\s*=/.test(line)) return null;
            const col = line.search(/\bvar\b/) + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 3,
                severity: 'info',
                message: 'Typed `var` declaration detected — valid in v5.',
                code: 'PS007',
            };
        },
    },

    // PS008 — plot() with no title argument
    {
        code: 'PS008',
        severity: 'warning',
        check: (line, lineIndex) => {
            if (!/\bplot\s*\(/.test(line)) return null;
            if (/title\s*=/.test(line)) return null;
            const col = line.indexOf('plot') + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 4,
                severity: 'warning',
                message: '`plot()` call is missing a `title=` argument. This makes the indicator hard to identify on the chart.',
                code: 'PS008',
            };
        },
    },

    // PS009 — stray closing bracket on its own line after non-block context
    {
        code: 'PS009',
        severity: 'info',
        check: (line, lineIndex) => {
            if (!/^\s*\)\s*$/.test(line)) return null;
            return {
                line: lineIndex + 1, col: line.indexOf(')') + 1, endCol: line.indexOf(')') + 2,
                severity: 'info',
                message: 'Stray closing parenthesis on its own line.',
                code: 'PS009',
            };
        },
    },

    // PS010 — alert() without message string
    {
        code: 'PS010',
        severity: 'warning',
        check: (line, lineIndex) => {
            if (!/\balert\s*\(\s*\)/.test(line)) return null;
            const col = line.indexOf('alert') + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 5,
                severity: 'warning',
                message: '`alert()` called with no message argument.',
                code: 'PS010',
            };
        },
    },

    // PS011 — use of undeclared bgcolor without na check
    {
        code: 'PS011',
        severity: 'info',
        check: (line, lineIndex) => {
            if (!/\bbgcolor\s*\(/.test(line)) return null;
            if (/condition|na\(|bool/.test(line)) return null;
            const col = line.indexOf('bgcolor') + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 7,
                severity: 'info',
                message: '`bgcolor()` runs on every bar. Wrap in a condition to avoid unexpected background fills.',
                code: 'PS011',
            };
        },
    },

    // PS012 — trailing whitespace (style)
    {
        code: 'PS012',
        severity: 'info',
        check: (line, lineIndex) => {
            if (!/\s+$/.test(line) || !line.trim()) return null;
            return {
                line: lineIndex + 1, col: line.trimEnd().length + 1, endCol: line.length + 1,
                severity: 'info',
                message: 'Trailing whitespace.',
                code: 'PS012',
                quickFix: { label: 'Remove trailing whitespace', replacement: line.trimEnd() },
            };
        },
    },
];

// ─── Generic / Fallback Rules ────────────────────────────────────────────────

const GENERIC_RULES: LintRule[] = [
    {
        code: 'GN001',
        severity: 'warning',
        check: (line, lineIndex) => {
            if (!/\bconsole\.log\s*\(/.test(line)) return null;
            const col = line.indexOf('console.log') + 1;
            return {
                line: lineIndex + 1, col, endCol: col + 11,
                severity: 'warning',
                message: '`console.log` left in code. Remove before production.',
                code: 'GN001',
            };
        },
    },
    {
        code: 'GN002',
        severity: 'info',
        check: (line, lineIndex) => {
            if (!/\bTODO\b|\bFIXME\b|\bHACK\b/.test(line)) return null;
            const col = Math.max(line.indexOf('TODO'), line.indexOf('FIXME'), line.indexOf('HACK')) + 1;
            const match = (line.match(/\b(TODO|FIXME|HACK)\b/) || [])[0] ?? 'TODO';
            return {
                line: lineIndex + 1, col, endCol: col + match.length,
                severity: 'info',
                message: `${match} comment found.`,
                code: 'GN002',
            };
        },
    },
];

// ─── Main export ─────────────────────────────────────────────────────────────

export function lintCode(code: string, domain: string): Diagnostic[] {
    if (!code.trim()) return [];

    const lines = code.split('\n');
    const results: Diagnostic[] = [];
    const seen = new Set<string>(); // dedupe PS001 (only emit once)

    const rules: LintRule[] =
        domain === 'pinescript' ? [...PINE_RULES, ...GENERIC_RULES]
            : domain === 'python' ? [...GENERIC_RULES]
                : [...GENERIC_RULES];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const rule of rules) {
            const d = rule.check(line, i, lines);
            if (!d) continue;

            // Deduplicate file-level rules (PS001 emits on line 0 always)
            const key = `${d.code}:${d.line}:${d.col}`;
            if (seen.has(key)) continue;
            seen.add(key);

            results.push(d);
        }
    }

    // Sort: errors first, then warnings, then info; then by line
    return results.sort((a, b) => {
        const order = { error: 0, warning: 1, info: 2 };
        const severityDiff = order[a.severity] - order[b.severity];
        return severityDiff !== 0 ? severityDiff : a.line - b.line;
    });
}

export function severityIcon(s: DiagnosticSeverity): string {
    return s === 'error' ? '🔴' : s === 'warning' ? '🟡' : 'ℹ️';
}

export function severityColor(s: DiagnosticSeverity): string {
    return s === 'error' ? '#f87171' : s === 'warning' ? '#fbbf24' : '#60a5fa';
}