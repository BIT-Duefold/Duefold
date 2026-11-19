import mark from './assets/uni-mark.svg?raw';

// Line-art version of the university emblem taken from the campus SSO page.
// Strokes use currentColor, so the mark follows the surrounding theme.
export function UniMark({size = 18}: {size?: number}) {
  return <span className="uni-mark" aria-hidden="true" style={{width: size, height: size}} dangerouslySetInnerHTML={{__html: mark}}/>;
}
