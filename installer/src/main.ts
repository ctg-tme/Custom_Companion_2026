import '@momentum-design/tokens/dist/css/core/complete.css';
import '@momentum-design/tokens/dist/css/theme/webex/light-stable.css';
import '@momentum-design/tokens/dist/css/typography/complete.css';
import './styles.css';
import { InstallerApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Installer root element is missing.');

void new InstallerApp(root).initialize();
