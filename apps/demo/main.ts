import './style.css';

import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { register, StaticMetadataProvider } from 'monaco-language-trino';

self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
};

const example =  `SELECT
    country,
    listagg(city, ',')
        WITHIN GROUP (ORDER BY population DESC)
        FILTER (WHERE population >= 10_000_000) megacities
FROM (VALUES
    ('India', 'Bangalore', 13_700_000),
    ('India', 'Chennai', 12_200_000),
    ('India', 'Ranchi', 1_547_000),
    ('Austria', 'Vienna', 1_897_000),
    ('Poland', 'Warsaw', 1_765_000)
) t(country, city, population)
GROUP BY country
ORDER BY country;

SELECT CAST(x AS varchar(32)), CAST(y AS integer) FROM t;
`;

monaco.editor.defineTheme('trino-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: '0000FF' },
    { token: 'string', foreground: 'A31515' },
    { token: 'number', foreground: '098658' },
    { token: 'comment', foreground: '008000' },
    { token: 'operator', foreground: '000000' },
    { token: 'type', foreground: '267f99' },
    { token: 'identifier', foreground: '001080' },
    { token: 'delimiter', foreground: '000000' },
  ],
  colors: {},
});

register(monaco, {
  metadataProvider: new StaticMetadataProvider(),
});

const model = monaco.editor.createModel(example, 'trino-sql');

const editor = monaco.editor.create(document.getElementById('root')!, {
  model,
  language: 'trino-sql',
  theme: 'trino-light',
  fontFamily: 'monospace',
  wordBasedSuggestions: 'off',
  'semanticHighlighting.enabled': true,
});
