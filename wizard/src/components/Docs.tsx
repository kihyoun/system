import { memo, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Divider, IconButton, InputAdornment, Link, List, ListItemButton, ListItemText, Paper, Stack, TextField, Typography } from '@mui/material';
import Search from '@mui/icons-material/Search';
import Close from '@mui/icons-material/Close';
import ArrowBack from '@mui/icons-material/ArrowBack';
import ArrowForward from '@mui/icons-material/ArrowForward';
import { docsHref, docsLocation, localizedChapters, searchDocs } from '../docs/model';
import Markdown from './docs/Markdown';
import MigrationGuide from './docs/MigrationGuide';
import { useI18n } from '../i18n';

function useDocsLocation() {
  const [location, setLocation] = useState(() => docsLocation());
  useEffect(() => {
    const update = () => setLocation(docsLocation());
    window.addEventListener('hashchange', update); window.addEventListener('popstate', update);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);
  return location;
}

export function DocsNavigation({ onNavigate = () => {} }: { onNavigate?: () => void }) {
  const { locale, t } = useI18n();
  const chapters = localizedChapters(locale);
  const { chapter } = useDocsLocation();
  return <Box component="nav" aria-label={t('Documentation chapters')} sx={{ p: 1.5 }}>
    <Typography variant="overline" sx={{ px: 1.5, color: 'text.secondary', letterSpacing: 1.5 }}>{t('Handbook')}</Typography>
    <List dense disablePadding>{chapters.map((item, itemIndex) => <Box component="li" key={item.id} sx={{ listStyle: 'none' }}>
      {itemIndex > 0 && item.group !== chapters[itemIndex - 1].group && <Typography variant="caption" component="div" sx={{ mt: 2, mb: .6, px: 1.5, fontWeight: 700, color: 'text.secondary' }}>{item.group}</Typography>}
      <ListItemButton component="a" href={docsHref(item.id)} selected={chapter.id === item.id} aria-current={chapter.id === item.id ? 'page' : undefined} onClick={onNavigate} sx={{ borderRadius: 1, my: .3, alignItems: 'flex-start', borderLeft: 3, borderColor: chapter.id === item.id ? 'primary.main' : 'transparent', '&.Mui-selected': { bgcolor: 'action.selected' } }}>
        <ListItemText primary={item.title} slotProps={{ primary: { sx: { fontSize: '.9rem', lineHeight: 1.55, fontWeight: chapter.id === item.id ? 650 : 400 } } }} />
      </ListItemButton>
    </Box>)}</List>
  </Box>;
}

function Docs({ navigationVersion = 0 }: { navigationVersion?: number }) {
  const { locale, t } = useI18n();
  const chapters = localizedChapters(locale);
  const [location, setLocation] = useState(() => docsLocation());
  const [query, setQuery] = useState('');
  const reader = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const { anchor } = location;
  const chapter = chapters.find(item => item.id === location.chapter.id) ?? chapters[0];
  const index = chapters.indexOf(chapter);
  const results = searchDocs(query, chapters);
  useEffect(() => { setQuery(''); }, [navigationVersion]);

  useEffect(() => {
    const update = () => { setLocation(docsLocation()); setQuery(''); };
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);

  useEffect(() => {
    const target = anchor ? document.getElementById(`docs-section-${anchor}`) : title.current;
    target?.focus({ preventScroll: true });
    (anchor ? target : reader.current)?.scrollIntoView?.({ block: 'start', behavior: 'instant' });
  }, [chapter.id, anchor]);

  function closeNavigation() { setQuery(''); }

  return <Box ref={reader} sx={{ maxWidth: 1480, mx: 'auto', width: '100%', minWidth: 0, scrollMarginTop: '7rem' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: { xs: 2, md: 4 }, py: 3, borderBottom: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
      <Box sx={{ flexGrow: 1 }}><Typography variant="h5" component="div" sx={{ fontWeight: 700 }}>{t('Documentation')}</Typography><Typography variant="body2" color="text.secondary">{t('From your first platform to its next generation.')}</Typography></Box>
      <TextField label={t('Search all docs')} size="small" value={query} onChange={event => setQuery(event.target.value)} slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment>, endAdornment: query ? <InputAdornment position="end"><IconButton size="small" aria-label={t('Clear documentation search')} onClick={() => setQuery('')}><Close fontSize="small" /></IconButton></InputAdornment> : undefined } }} sx={{ width: { xs: '100%', sm: 330 } }} />
    </Box>
    <Box sx={{ display: 'flex', alignItems: 'flex-start', minWidth: 0 }}>
      <Box component="section" aria-label={t('Documentation')} sx={{ minWidth: 0, flex: 1, px: { xs: 2, sm: 4, lg: 6 }, py: { xs: 3, md: 4 }, maxWidth: 1080 }}>
        {query.trim() ? <Box role="region" aria-label={t('Documentation search results')}>
          <Typography variant="h5" component="h1">{t('Search results')}</Typography><Typography role="status" color="text.secondary" sx={{ my: 2 }}>{t('docs.searchResults', { count: results.length, query: query.trim() })}</Typography>
          {!results.length && <Alert severity="info">{t('No matching chapters. Try a service name, command or a shorter phrase.')}</Alert>}
          <Stack spacing={2}>{results.map(result => <Paper key={result.chapter.id} variant="outlined" sx={{ p: 2.5 }}><Link href={docsHref(result.chapter.id, result.anchor)} onClick={closeNavigation} variant="h6">{t(result.chapter.title)}</Link><Typography sx={{ mt: 1, lineHeight: 1.7 }} color="text.secondary">{result.snippet}</Typography></Paper>)}</Stack>
        </Box> : <Box component="article">
          <Chip size="small" label={t(chapter.group)} variant="outlined" sx={{ mb: 2 }} />
          <Typography variant="h3" component="h1" ref={title} tabIndex={-1} sx={{ fontSize: { xs: '1.9rem', sm: '2.5rem' }, fontWeight: 750, letterSpacing: '-.04em', lineHeight: 1.2, mb: 3, scrollMarginTop: '7rem', outline: 'none' }}>{t(chapter.title)}</Typography>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, mb: 3, borderRadius: 2, bgcolor: 'action.hover' }}><Typography variant="subtitle2" sx={{ mb: .5 }}>{t('Before you begin')}</Typography><Typography variant="body2" sx={{ lineHeight: 1.7 }}>{t(chapter.prerequisite)}</Typography><Divider sx={{ my: 1.5 }} /><Typography variant="subtitle2" sx={{ mb: .5 }}>{t('Expected result')}</Typography><Typography variant="body2" sx={{ lineHeight: 1.7 }}>{t(chapter.outcome)}</Typography></Paper>
          {chapter.headings.length > 3 && <Box component="nav" aria-label={t('On this page')} sx={{ mb: 4 }}><Typography variant="overline" color="text.secondary">{t('On this page')}</Typography><Stack spacing={.65}>{chapter.headings.filter((h, i) => i > 0 && h.level <= 3).map(h => <Link key={h.anchor} href={docsHref(chapter.id, h.anchor)} variant="body2">{h.title}</Link>)}</Stack></Box>}
          {chapter.id === 'releases' && <MigrationGuide />}
          <Markdown key={chapter.id} chapter={chapter} />
          <Divider sx={{ mt: 5, mb: 3 }} />
          <Stack component="nav" aria-label={t('Chapter navigation')} direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', alignItems: 'stretch' }}>
            {index > 0 && <Button component="a" href={docsHref(chapters[index - 1].id)} startIcon={<ArrowBack />} variant="outlined" sx={{ textAlign: 'left', justifyContent: 'flex-start' }}>{t('Previous:')} {t(chapters[index - 1].title)}</Button>}
            {index < chapters.length - 1 && <Button component="a" href={docsHref(chapters[index + 1].id)} endIcon={<ArrowForward />} variant="outlined" sx={{ ml: { sm: 'auto' }, textAlign: 'right', justifyContent: 'flex-end' }}>{t('Next:')} {t(chapters[index + 1].title)}</Button>}
          </Stack>
        </Box>}
      </Box>
    </Box>
  </Box>;
}

export default memo(Docs);
