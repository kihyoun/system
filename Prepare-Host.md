## Install

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/bootstrapper/install.sh)"
```

(Optional) Install zsh and pull .zshrc:

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
sh -c "$(curl https://raw.githubusercontent.com/kihyoun/system/main/.zshrc -o /root/.zshrc)"
```

## Checkout
This will checkout the Bootstrapper

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/bootstrapper/checkout.sh)"
```

## Boot
```bash
bash start.sh
```

## Shutdown
```bash
bash stop.sh
```
