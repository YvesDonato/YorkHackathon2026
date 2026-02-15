declare module "three-spritetext" {
  import { Sprite } from "three";

  export default class SpriteText extends Sprite {
    constructor(text?: string, textHeight?: number, color?: string);
    text: string;
    textHeight: number;
    color: string;
    strokeWidth: number;
    strokeColor: string;
    fontFace: string;
    fontSize: number;
    fontWeight: string | number;
    backgroundColor: string | false;
    padding: number;
    borderWidth: number;
    borderRadius: number;
    borderColor: string;
  }
}
