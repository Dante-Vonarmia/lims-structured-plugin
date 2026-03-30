# Windows 11 Docker 使用说明（页面操作版）

## 1. 下载项目（页面操作）
1. 打开 VPN
2. 浏览器打开：`https://github.com/Dante-Vonarmia/lims-structured-plugin`
3. 点击绿色 `Code`
4. 点击 `Download ZIP`
5. 打开下载好的 ZIP，点击“全部解压”

## 2. 安装 Docker Desktop（页面操作）
1. 浏览器打开：`https://www.docker.com/products/docker-desktop/`
2. 点击 `Download for Windows`
3. 下载后双击安装
4. 安装完成后启动 Docker Desktop
5. 右下角看到 Docker 图标并显示运行中（Engine running）

## 3. 启动项目（仅这一条命令）
1. 在解压后的项目文件夹空白处按住 `Shift` + 鼠标右键
2. 点击“在终端中打开”
3. 粘贴并执行：
```powershell
docker compose up -d --build
```
4. 浏览器打开：
```text
http://127.0.0.1:18081/
```

## 4. 后续再次打开（仅这一条命令）
```powershell
docker compose up -d
```

## 5. 需要关闭时（仅这一条命令）
```powershell
docker compose down
```
