export declare const FORBIDDEN: string[];
export declare const TRIAL_ONLY_MARKERS: string[];
export declare const TRIAL_FORBIDDEN_ENV: RegExp;
export declare const REQUIRED: string[];
export declare const OUT_DIR: string;
export interface BundleCheckOptions {
  trial?: boolean;
}
export declare function findTestHooks(dir: string): string[];
export declare function findTrialMarkers(dir: string): string[];
export declare function findTrialEnvLeaks(dir: string): string[];
export declare function checkPackageableBundle(dir: string, options?: BundleCheckOptions): string[];
export declare function assertPackageableBundle(dir?: string, options?: BundleCheckOptions): void;
