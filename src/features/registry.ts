import type { ComponentType } from 'preact';
import type { Key } from '../i18n';
import type { IconName } from '../ui/Icon';
import { ChordsScreen } from './chords/Chords';
import { Home } from './home/Home';
import { MetronomeScreen } from './metronome/Metronome';
import { Settings } from './settings/Settings';
import { Tuner } from './tuner/Tuner';

export interface Feature {
  id: string;
  title: Key;
  /** Ana sayfadaki kart açıklaması. */
  desc?: Key;
  icon: IconName;
  component: ComponentType;
  /** Mobil alt çubukta gösterilsin mi (en fazla 5). */
  primary?: boolean;
  /** Ana sayfadaki araç listesinde gösterilsin mi. */
  tool?: boolean;
}

/** Uygulamadaki ekranlar. Yeni bir aşama bittiğinde buraya eklenir. */
export const FEATURES: Feature[] = [
  { id: 'home', title: 'nav.home', icon: 'home', component: Home, primary: true },
  { id: 'tuner', title: 'nav.tuner', desc: 'home.tuner.desc', icon: 'tuner', component: Tuner, primary: true, tool: true },
  {
    id: 'metronome',
    title: 'nav.metronome',
    desc: 'home.metronome.desc',
    icon: 'metronome',
    component: MetronomeScreen,
    primary: true,
    tool: true,
  },
  {
    id: 'chords',
    title: 'nav.chords',
    desc: 'home.chords.desc',
    icon: 'chords',
    component: ChordsScreen,
    primary: true,
    tool: true,
  },
  { id: 'settings', title: 'nav.settings', icon: 'settings', component: Settings, primary: true },
];

export function findFeature(id: string): Feature {
  return FEATURES.find((f) => f.id === id) ?? FEATURES[0];
}
