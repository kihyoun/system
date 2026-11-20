import { useState } from 'react';
import { Alert, Box, Button, Typography, useTheme } from '@mui/material';
import ContentCopy from '@mui/icons-material/ContentCopy';
import Check from '@mui/icons-material/Check';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import nginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { copyableCode } from '../../docs/model';
import { useI18n } from '../../i18n';

for (const [name, grammar] of Object.entries({ bash, sh: bash, shell: bash, powershell, pwsh: powershell, json, yaml, yml: yaml, ini, dockerfile: docker, python, javascript, typescript, nginx })) {
  SyntaxHighlighter.registerLanguage(name, grammar);
}

export default function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = copyableCode(code, language);
  async function copyCode() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(copy!);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }
  return <Box sx={{ my: 2.5, border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', minWidth: 0 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: .6, bgcolor: 'action.hover', gap: 1 }}>
      <Typography variant="caption" sx={{ fontFamily: 'monospace', textTransform: 'uppercase' }}>{language || t('Example output')}</Typography>
      {copy !== undefined && <Button size="small" onClick={copyCode} startIcon={status === 'copied' ? <Check fontSize="small" /> : <ContentCopy fontSize="small" />} aria-label={status === 'copied' ? t('Copied') : t('code.copyExample', { language })}>
        <span role="status">{t(status === 'copied' ? 'Copied' : 'Copy')}</span>
      </Button>}
    </Box>
    <SyntaxHighlighter language={language || 'text'} style={theme.palette.mode === 'dark' ? oneDark : oneLight} customStyle={{ margin: 0, padding: '1.1rem', fontSize: '.85rem', lineHeight: 1.7, borderRadius: 0 }} codeTagProps={{ style: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' } }}>
      {code.trimEnd()}
    </SyntaxHighlighter>
    {status === 'failed' && <Alert severity="warning">{t('Could not copy. Select the example and copy it manually; clipboard access requires a secure browser context and permission.')}</Alert>}
  </Box>;
}
