# Third-party notices

## Reference project

- Project: 党旗飘飘~~~UESTC
- Version reviewed: 1.4.0
- Author: Onion / Onion_Big
- Source: <https://greasyfork.org/zh-CN/scripts/442470>
- License declared by upstream: MIT

UIBE jjfz 学习助手参考了上游的开始/停止、页面选择器、弹窗处理和下一节流程。自动操作、扩展界面、会话状态和打包实现已重新整理，上游署名和 MIT 许可信息予以保留。

本项目不分发或执行原版自动化脚本。实现改为按提示全文分类，保留异常和验证提示，固定检查间隔，并仅在平台明确确认完成后开放下一节。课程导航采用当前页面已有链接。

## Development dependencies

- jsdom — MIT: <https://github.com/jsdom/jsdom>
- fflate — MIT: <https://github.com/101arrowz/fflate>

这些依赖只参与测试和打包，不进入浏览器扩展运行包。各依赖及传递依赖的许可证保留在安装后的包目录中。
