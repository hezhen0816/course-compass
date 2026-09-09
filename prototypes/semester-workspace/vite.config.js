import { fileURLToPath } from 'node:url';
const dependency = (name) => fileURLToPath(new URL(`../../web/node_modules/${name}`, import.meta.url));
export default {
  resolve: { alias: {
    'react-dom': dependency('react-dom'),
    react: dependency('react'),
    'lucide-react': dependency('lucide-react'),
  } },
};
