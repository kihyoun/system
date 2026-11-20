import { useEffect, useState } from 'react';

export interface PublicSiteInfo {
    operatorName: string;
    operatorAddress: string;
    contactEmail: string;
    privacyNoticeUrl: string;
    accessLogRetention: string;
    additionalPrivacyText: string;
}

export function readPublicSiteInfo(value: unknown): PublicSiteInfo {
    const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const text = (key: string) => typeof data[key] === 'string' ? data[key].trim() : '';
    return {
        operatorName: text('operatorName'), operatorAddress: text('operatorAddress'),
        contactEmail: text('contactEmail'), privacyNoticeUrl: text('privacyNoticeUrl'),
        accessLogRetention: text('accessLogRetention'), additionalPrivacyText: text('additionalPrivacyText')
    };
}

export function publicNoticeUrl(value: string): string | undefined {
    try {
        const url = new URL(value);
        if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* An optional invalid URL is not an executable link. */ }
    return undefined;
}

export function usePublicSiteInfo(active: boolean) {
    const [info, setInfo] = useState(() => readPublicSiteInfo(null));
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!active) return;
        const controller = new AbortController();
        setLoading(true);
        void fetch('/privacy-instance.json', {
            credentials: 'omit', cache: 'no-store', mode: 'same-origin', redirect: 'error',
            referrerPolicy: 'no-referrer', signal: controller.signal
        }).then(async response => {
            if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
            return response.json() as Promise<unknown>;
        }).then(value => {
            if (!controller.signal.aborted) setInfo(readPublicSiteInfo(value));
        }).catch(() => {
            if (!controller.signal.aborted) setInfo(readPublicSiteInfo(null));
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [active]);
    return { info, loading };
}
