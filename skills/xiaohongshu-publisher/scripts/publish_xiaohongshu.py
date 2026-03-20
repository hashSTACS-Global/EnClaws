#!/usr/bin/env python3
"""
小红书发布助手 - 自动化发布图文笔记

用法：
    python publish_xiaohongshu.py --title "标题" --body "正文" [--images img1.jpg img2.jpg]

依赖：
    pip install playwright
    playwright install chromium
"""

import argparse
import sys
import time
import os
from pathlib import Path

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError


def parse_args():
    parser = argparse.ArgumentParser(description="小红书图文发布自动化脚本")
    parser.add_argument("--title", required=True, help="笔记标题")
    parser.add_argument("--body", required=True, help="笔记正文")
    parser.add_argument("--images", nargs="*", default=[], help="图片文件路径列表")
    return parser.parse_args()


def wait_for_manual_login(page, timeout=300):
    """等待用户手动登录"""
    print("需要登录小红书。请在打开的浏览器中手动登录，登录后脚本将自动继续。")
    print("如果你已经登录，请忽略此消息。")
    # 等待直到检测到登录成功（通过URL或元素）
    start = time.time()
    while time.time() - start < timeout:
        if "creator.xiaohongshu.com" in page.url and not page.url.startswith("https://creator.xiaohongshu.com/login"):
            # 检查是否有登录表单
            login_form = page.query_selector("form")
            if not login_form:
                print("检测到已登录，继续执行...")
                return True
        time.sleep(2)
    print("等待登录超时，请重新运行脚本。")
    return False


def main():
    args = parse_args()

    # 验证图片文件存在
    image_paths = []
    for img in args.images:
        p = Path(img)
        if not p.exists():
            print(f"错误：图片文件不存在：{img}")
            sys.exit(1)
        image_paths.append(str(p.resolve()))

    with sync_playwright() as p:
        # 启动浏览器（有头模式，让用户看到操作）
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        print("打开小红书创作平台...")
        page.goto("https://creator.xiaohongshu.com")

        # 检查是否需要登录
        if page.url.startswith("https://creator.xiaohongshu.com/login") or "login" in page.url:
            if not wait_for_manual_login(page):
                browser.close()
                sys.exit(1)

        # 等待页面加载完成
        page.wait_for_load_state("networkidle")

        # 点击“上传图文”按钮
        print("定位上传图文按钮...")
        # 尝试多种选择器
        upload_selectors = [
            "text=上传图文",
            "button:has-text('上传图文')",
            "div:has-text('上传图文')",
            "[class*='upload']"
        ]
        upload_btn = None
        for selector in upload_selectors:
            try:
                upload_btn = page.wait_for_selector(selector, timeout=5000)
                if upload_btn:
                    break
            except PlaywrightTimeoutError:
                continue
        if not upload_btn:
            print("未找到上传图文按钮，可能页面结构已变化。")
            browser.close()
            sys.exit(1)

        upload_btn.click()
        print("已点击上传图文")

        # 等待发布页面加载
        page.wait_for_url("**/publish/**", timeout=10000)

        # 填写标题
        print("填写标题...")
        title_input = page.wait_for_selector("input[placeholder*='标题'], textarea[placeholder*='标题']")
        title_input.fill(args.title)

        # 填写正文
        print("填写正文...")
        body_input = page.wait_for_selector("textarea[placeholder*='分享你的生活态度'], div[contenteditable='true']")
        body_input.fill(args.body)

        # 上传图片
        if image_paths:
            print(f"上传 {len(image_paths)} 张图片...")
            # 点击上传区域触发文件选择
            upload_area = page.wait_for_selector("input[type='file']")
            # 设置多个文件
            upload_area.set_input_files(image_paths)
            # 等待上传完成（简单等待，可根据图片大小调整）
            print("等待图片上传...")
            time.sleep(5)  # 可以根据需要优化等待条件

        # 点击发布按钮
        print("点击发布...")
        publish_btn = page.wait_for_selector("button:has-text('发布'), button:has-text('发布笔记')")
        publish_btn.click()

        # 等待发布成功（可能跳转或出现成功提示）
        try:
            # 等待页面跳转或出现成功提示
            page.wait_for_url("**/publish/success**", timeout=10000)
            print("发布成功！")
        except PlaywrightTimeoutError:
            # 可能没跳转，检查是否有成功提示
            success_text = page.query_selector("text=发布成功")
            if success_text:
                print("发布成功！")
            else:
                print("发布可能已成功，但未能确认。请手动检查。")

        # 获取最终笔记URL（如果可能）
        final_url = page.url
        if "publish/success" in final_url:
            # 成功页面可能包含笔记链接
            link = page.query_selector("a:has-text('查看笔记')")
            if link:
                note_url = link.get_attribute("href")
                print(f"笔记链接：{note_url}")
        else:
            print(f"当前页面：{final_url}")

        input("按回车键关闭浏览器...")  # 让用户确认后再关闭
        browser.close()


if __name__ == "__main__":
    main()
