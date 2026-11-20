import {shellQuote, shellValue} from './Environment';

/**
 * General Configuration Object
 */
export default class Helper {
  public static get textLogo() {
    return `#-------------------------------------------------------------
#                +------------------+                        |
#               /|                 /|                        |
#              / |                / |                        |
#             *--+---------------*  |                        |
#             |  |               |  |                        |
#             |  |  System       |  |                        |
#             |  |  Bootstrapper |  |                        |
#             |  +---------------+--+                        |
#             | /                | /                         |
#             |/                 |/                          |
#             *------------------*                           |
#    +------+ https://www.system-bootstrapper.com
#$  /      /|                                                |
#  +------+ |                                                |
#  |      | +                                                |
#  |      |/                                                 |
#  +------+                                                  |
#-------------------------------------------------------------
`;
  }

  static unquote(value:string) {
    return shellValue(String(value ?? ''));
  }

  static quote(value:any) {
    return shellQuote(value);
  }
}
