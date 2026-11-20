import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { publicNoticeUrl, readPublicSiteInfo, usePublicSiteInfo } from './PublicSiteInfo';

afterEach(() => vi.unstubAllGlobals());

test('public information ignores secret and nonstring fields and never creates executable notice links', () => {
    expect(readPublicSiteInfo({ operatorName: ' Example ', contactEmail: 123,
        SYNC_PASS: 'must-never-appear', accessToken: 'must-never-appear' })).toEqual({
        operatorName: 'Example', operatorAddress: '', contactEmail: '', privacyNoticeUrl: '',
        accessLogRetention: '', additionalPrivacyText: ''
    });
    expect(publicNoticeUrl('javascript:alert(1)')).toBeUndefined();
    expect(publicNoticeUrl('https://user:password@example.test/privacy')).toBeUndefined();
    expect(publicNoticeUrl('https://example.test/privacy')).toBe('https://example.test/privacy');
});

function PublicInformation({ active }: { active: boolean }) {
    const { info, loading } = usePublicSiteInfo(active);
    return <div>{loading ? 'loading' : info.operatorName || 'not configured'}</div>;
}

test('operator information is requested only on a public legal view, without credentials or redirects', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ operatorName: 'Published Operator' }),
        { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    const { rerender } = render(<PublicInformation active={false} />);
    expect(fetch).not.toHaveBeenCalled();
    rerender(<PublicInformation active={true} />);
    await screen.findByText('Published Operator');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/privacy-instance.json', expect.objectContaining({
        credentials: 'omit', mode: 'same-origin', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'
    }));
});

test('missing public information and an HTML SPA fallback remain an honest unconfigured notice', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('<html>private settings are not JSON</html>',
        { headers: { 'content-type': 'text/html' } })).mockRejectedValueOnce(new Error('not available'));
    vi.stubGlobal('fetch', fetch);
    const { rerender } = render(<PublicInformation active={true} />);
    await screen.findByText('not configured');
    rerender(<PublicInformation active={false} />);
    await act(async () => { rerender(<PublicInformation active={true} />); });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await screen.findByText('not configured');
});
