# Team Assignment System - Next.js 版本

这是一个基于 Next.js 重构的比赛选手人员分配系统。原系统是使用纯 HTML、CSS 和 JavaScript 构建的，现在我们将其重构为现代化的 Next.js 应用程序。

## 功能特点

- 使用 Next.js 构建的现代化 React 应用
- 响应式设计，适配各种设备屏幕
- 服务端渲染 (SSR) 提供更好的性能和 SEO
- API 路由处理数据请求
- 组件化架构，易于维护和扩展

## 技术栈

- [Next.js](https://nextjs.org/) - React 框架
- [React](https://reactjs.org/) - JavaScript 库
- CSS Modules 和全局样式

## 目录结构

```
.
├── components/        # React 组件
├── pages/             # 页面和 API 路由
├── public/            # 静态资源
├── styles/            # 全局样式
├── data/              # 数据文件
└── package.json       # 项目依赖和脚本
```

## 快速开始

1. 安装依赖:
   ```bash
   npm install
   ```

2. 开发模式运行:
   ```bash
   npm run dev
   ```

3. 构建生产版本:
   ```bash
   npm run build
   ```

4. 启动生产服务器:
   ```bash
   npm start
   ```

访问 http://localhost:3000 查看应用。

## 页面

- `/` - 主页，包含队伍分配和选手管理功能

## API 路由

- `/api/teams` - 队伍相关操作
- `/api/players` - 选手相关操作

## 部署

可以部署到 [Vercel](https://vercel.com/)（Next.js 官方支持平台）或其他支持 Node.js 的平台。

## 开发

### 添加新功能

1. 在 `components/` 目录中创建新的 React 组件
2. 在 `pages/` 目录中添加新页面或修改现有页面
3. 如需 API 接口，在 `pages/api/` 中添加新的 API 路由

### 样式

全局样式位于 `styles/globals.css`，组件特定样式可以使用 CSS Modules。

## 与原系统的区别

1. 使用 React 组件化开发，提高代码复用性和可维护性
2. 通过 Next.js 实现服务端渲染，提升首屏加载速度和 SEO
3. 使用 API 路由替代原来的 JSON 文件读取方式
4. 更好的开发体验和热重载功能
5. 更容易扩展和部署到云端