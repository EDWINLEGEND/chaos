export declare function isSafeTarget(uri: string): boolean;
export declare function isRehearsalBranch(branchName: string): boolean;
export declare function isRehearsalPR(pr: {
    title: string;
    headRef: string;
    number: number;
}): boolean;
export declare function restoreAgentsBaseline(agentsPath?: string, fixturePath?: string): {
    restored: boolean;
    wasModified: boolean;
};
export declare function stripExtraneousIndexes(): Promise<number>;
export declare function resetPaymentProvider(providerUrl?: string, storeFilePath?: string): Promise<{
    success: boolean;
    eventsCleared: boolean;
}>;
export interface GithubCleanupResult {
    status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
    prsClosed: number;
    branchesDeleted: number;
    canonicalPreserved: boolean;
    message?: string;
}
export declare function cleanupGithubRehearsals(options?: {
    token?: string;
    repository?: string;
}): Promise<GithubCleanupResult>;
export declare function runReset(): Promise<void>;
//# sourceMappingURL=reset.d.ts.map