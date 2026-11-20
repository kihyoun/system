import JSZip from 'jszip';
import md5 from 'md5';
import Main from './Main';
import MainConfig from './MainConfig';
import { environment, shellValue } from './Environment';

const examples = {
    WIZARD_OPERATOR_NAME: 'Max Mustermann',
    WIZARD_OPERATOR_ADDRESS: 'Musterstraße 1\n12345 Musterstadt\nDeutschland',
    WIZARD_OPERATOR_EMAIL: 'kontakt@example.com'
};
const optional = ['WIZARD_PRIVACY_NOTICE_URL', 'WIZARD_ACCESS_LOG_RETENTION', 'WIZARD_PRIVACY_TEXT'];
const assignments = (text: string) => Object.fromEntries(environment(text).map(([key, value]) => [key, shellValue(value)]));

test('fresh website settings contain the requested setup examples and no invented retention or privacy text', () => {
    const main = new Main();
    expect(main.config!.runtimeOptions).toEqual(examples);
    const env = assignments(main.config!.content);
    expect(env).toMatchObject(examples);
    for (const key of optional) expect(env[key]).toBeUndefined();
});

test('all six public website fields survive literal ENV, JSON Open and ZIP Backup without changing the Cube', async () => {
    const values = {
        WIZARD_OPERATOR_NAME: 'An Example Operator',
        WIZARD_OPERATOR_ADDRESS: 'Example street 1\n12345 Example Town\nCountry',
        WIZARD_OPERATOR_EMAIL: 'operator@example.test',
        WIZARD_PRIVACY_NOTICE_URL: 'https://example.test/privacy?a=b&c=d',
        WIZARD_ACCESS_LOG_RETENTION: 'According to the operator’s configured retention policy.',
        WIZARD_PRIVACY_TEXT: 'Quoted "text", apostrophe\'s and literal $HOME / `id`.\nSecond line.'
    };
    const main = new Main(new MainConfig({ runtimeOptions: values }));
    const fetched = new Main();
    fetched.importEnvData(main.config!.content);
    expect(fetched.config!.runtimeOptions).toEqual(values);
    const reopened = new Main();
    reopened.importJson(new File([], 'bootstrapper.json'), JSON.stringify(fetched.asJson));
    expect(reopened.config!.runtimeOptions).toEqual(values);
    const zip = await JSZip.loadAsync(await reopened.generateZip());
    expect(JSON.parse(await zip.file('bootstrapper.json')!.async('string')).main.runtimeOptions).toEqual(values);
    const env = await zip.file('.docker.env')!.async('string');
    expect(assignments(env)).toMatchObject(values);
    expect(env[807]).toBe('$');
    expect(md5(env.slice(0, 1184))).toBe('bd4a8426355824593a5e21ad759830c1');
});

test('explicitly cleared public settings stay empty through ENV Fetch, JSON Open and ZIP Backup', async () => {
    const values = Object.fromEntries([...Object.keys(examples), ...optional].map(key => [key, '']));
    const main = new Main(new MainConfig({ runtimeOptions: values }));
    expect(main.config!.runtimeOptions).toEqual(values);
    const fetched = new Main();
    fetched.importEnvData(main.config!.content);
    expect(fetched.config!.runtimeOptions).toEqual(values);
    const reopened = new Main();
    reopened.importJson(new File([], 'bootstrapper.json'), JSON.stringify(fetched.asJson));
    const zip = await JSZip.loadAsync(await reopened.generateZip());
    expect(JSON.parse(await zip.file('bootstrapper.json')!.async('string')).main.runtimeOptions).toEqual(values);
    expect(assignments(await zip.file('.docker.env')!.async('string'))).toMatchObject(values);
});
