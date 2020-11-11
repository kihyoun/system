## Install dependencies

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/install.sh)"
```
## prepare Bootstrapper
This will checkout the Bootstrapper
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/install.sh)"
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/prepare.sh)"
```
Optionally, install zsh if you like:
```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
sh -c "$(curl https://raw.githubusercontent.com/kihyoun/system/main/.zshrc -o /root/.zshrc)"
```

## Feed the Seed!
This command unpacks the bootstrapper.zip, and mirrors the contents of the SEED_DIR into the Container.
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/feed.sh)"
```

