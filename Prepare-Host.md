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


## Restore
This will restore an existing Backup using the bootstrapper.zip
```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/install.sh)"
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/prepare.sh)"
bash -c "$(curl -fsSL https://raw.githubusercontent.com/kihyoun/system/main/restore.sh)"
```

