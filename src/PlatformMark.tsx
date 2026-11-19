import {PLATFORMS} from '../shared/model.mjs';
import type {Platform} from './types';

export function PlatformMark({id, small = false}: {id: Platform; small?: boolean}) {
  return <span className={`platform-mark ${small ? 'small' : ''}`} style={{'--platform': PLATFORMS[id].color} as React.CSSProperties}>{PLATFORMS[id].short}</span>;
}
