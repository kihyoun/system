export const BOOTSTRAPPER_CUBE = `#-------------------------------------------------------------
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

export function renderWelcome(version: string): string {
  return `${BOOTSTRAPPER_CUBE}\nSystem Bootstrapper ${version}\nYou build it. You own it.\n\nRun system-bootstrapper --help for available commands.\n`;
}
