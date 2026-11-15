import type { ComponentType } from 'preact';
import type { Key } from '../i18n';
import type { IconName } from '../ui/Icon';
import { BackingScreen } from './backing/Backing';
import { ChordsScreen } from './chords/Chords';
import { Home } from './home/Home';
import { LogScreen } from './log/Log';
import { MetronomeScreen } from './metronome/Metronome';
import { RhythmScreen } from './rhythm/Rhythm';
import { Settings } from './settings/Settings';
import { SongsScreen } from './songs/Songs';
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
  /** Bu ekranda geçen süre pratik günlüğünde hangi egzersiz türüne yazılır (yoksa "serbest"). */
  activity?: string;
}

/** Uygulamadaki ekranlar. Yeni bir aşama bittiğinde buraya eklenir. */
export const FEATURES: Feature[] = [
  { id: 'home', title: 'nav.home', icon: 'home', component: Home, primary: true },
  {
    id: 'tuner',
    title: 'nav.tuner',
    desc: 'home.tuner.desc',
    icon: 'tuner',
    component: Tuner,
    primary: true,
    tool: true,
    activity: 'tuning',
  },
  {
    id: 'metronome',
    title: 'nav.metronome',
    desc: 'home.metronome.desc',
    icon: 'metronome',
    component: MetronomeScreen,
    primary: true,
    tool: true,
    activity: 'rhythm',
  },
  {
    id: 'chords',
    title: 'nav.chords',
    desc: 'home.chords.desc',
    icon: 'chords',
    component: ChordsScreen,
    primary: true,
    tool: true,
    activity: 'chords',
  },
  {
    id: 'backing',
    title: 'nav.backing',
    desc: 'home.backing.desc',
    icon: 'band',
    component: BackingScreen,
    tool: true,
    activity: 'backing',
  },
  {
    id: 'rhythm',
    title: 'nav.rhythm',
    desc: 'home.rhythm.desc',
    icon: 'rhythm',
    component: RhythmScreen,
    tool: true,
    activity: 'rhythm',
  },
  {
    id: 'songs',
    title: 'nav.songs',
    desc: 'home.songs.desc',
    icon: 'song',
    component: SongsScreen,
    tool: true,
    activity: 'song',
  },
  { id: 'log', title: 'nav.log', desc: 'home.log.desc', icon: 'log', component: LogScreen, primary: true, tool: true },
  { id: 'settings', title: 'nav.settings', icon: 'settings', component: Settings },
];

export function findFeature(id: string): Feature {
  return FEATURES.find((f) => f.id === id) ?? FEATURES[0];
}
