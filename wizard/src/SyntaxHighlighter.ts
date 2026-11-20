import { PrismLight } from 'react-syntax-highlighter';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

PrismLight.registerLanguage('bash', bash);
PrismLight.registerLanguage('json', json);
PrismLight.registerLanguage('yaml', yaml);
export default PrismLight;
