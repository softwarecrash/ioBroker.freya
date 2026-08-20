/** Only ioBroker Admin instances may mutate the suggestion lifecycle. */
export function isTrustedApprovalSource(source: string): boolean {
    return /^system\.adapter\.admin\.\d+$/.test(source);
}
