import type {CSSProperties} from 'react';

type IconProps={size?:number;className?:string;strokeWidth?:number;style?:CSSProperties};
export type FluentIcon=(props:IconProps)=>React.JSX.Element;
// Segoe Fluent Icons uses the same supported glyph range as Segoe MDL2 Assets.
// Fonts are loaded locally; Microsoft system fonts are not redistributed.
function icon(code:number):FluentIcon {
  return function FluentGlyph({size=20,className,style}:IconProps){return <svg width={size} height={size} viewBox="0 0 24 24" className={`fluent-icon ${className||''}`} style={style} aria-hidden="true" focusable="false"><text x="12" y="12" textAnchor="middle" dominantBaseline="central" fontSize="20">{String.fromCodePoint(code)}</text></svg>;};
}
export const Sun=icon(0xe706),Moon=icon(0xe708),LayoutGrid=icon(0xe8a9),CalendarDays=icon(0xe787),CheckCheck=icon(0xe930);
export const Plus=icon(0xe710),Search=icon(0xe721),ChevronLeft=icon(0xe76b),ChevronRight=icon(0xe76c),ChevronDown=icon(0xe70d);
export const ArrowUpRight=icon(0xe8a7),RefreshCw=icon(0xe72c),Cloud=icon(0xe753),Download=icon(0xe896),Upload=icon(0xe898);
export const Settings2=icon(0xe713),X=icon(0xe711),Check=icon(0xe73e),BookOpen=icon(0xe82d),MoreHorizontal=icon(0xe712);
// F3B1 is Segoe's "SignOut" door glyph; E8AC is "Rename" and must not be used for exit actions.
export const Clock3=icon(0xe823),CircleHelp=icon(0xe897),Link2=icon(0xe71b),LogOut=icon(0xf3b1),ArrowRight=icon(0xe72a);
export const Inbox=icon(0xe715),CalendarCheck2=icon(0xe787),ShieldCheck=icon(0xe83d),ListTodo=icon(0xe8fd),WifiOff=icon(0xeb5e),Sparkles=icon(0xe734),Trash=icon(0xe74d);
export const Pin=icon(0xe718),EyeOff=icon(0xed1a);
