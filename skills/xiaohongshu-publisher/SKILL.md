---
name: xiaohongshu-publisher
description: Publish图文笔记 to Xiaohongshu automatically via browser automation. Use when the user says "发小红书", "小红书发布助手", or asks to publish content to Xiaohongshu. This skill handles opening the creator platform, filling in title and body text, uploading images, and submitting the post. Requires the user to be logged into Xiaohongshu in the OpenClaw browser profile.
---

# Xiaohongshu Publisher - 小红书发布助手

## Overview

This skill enables automated posting to Xiaohongshu (小红书) using browser automation. It takes a title, body text, and optional image paths, then navigates the Xiaohongshu creator platform to create and publish a图文笔记.

## When to Use

- User says "发小红书" followed by content
- User says "小红书发布助手" with content
- User asks to publish a图文教程 to Xiaohongshu
- User wants to automate repetitive posting tasks

## Prerequisites

1. **Browser profile**: Use OpenClaw's browser with profile="openclaw"
2. **Login status**: User must be logged into Xiaohongshu in that browser profile. The skill will check for login and guide if not.
3. **Creator platform access**: The Xiaohongshu account must have access to the creator platform (usually automatic).

## Input Format

The skill expects structured input. When the user provides content naturally, extract these fields:

- **Title** (required): The post headline
- **Body** (required): Main content text (supports markdown, emojis)
- **Image paths** (optional): Array of local file paths or URLs to images

### Example User Messages

> "发小红书：标题『OpenClaw部署教程』正文：这是一篇保姆级教程... 图片：C:\\pics\\cover.png"

> "小红书发布助手，帮我发这个图文：标题『AI工具推荐』内容：今天推荐几个好用的... 配图就放桌面上那几张"

If the user doesn't specify images, the skill will prompt for them or proceed with text-only post (if platform allows).

## Step-by-Step Workflow

### Step 1: Launch Browser and Verify Login

1. Use `browser` tool with `action="open"`, `profile="openclaw"`, `url="https://creator.xiaohongshu.com"` to open creator platform
2. Check if login is required by taking a snapshot and looking for login prompts
3. If not logged in, instruct user to log in manually and then continue

### Step 2: Navigate to Upload Interface

1. On creator platform, click the "上传图文" button (upload图文)
   - Use snapshot to find the correct element (ref often `e107` or similar)
2. Wait for the upload form to load

### Step 3: Fill Content

**Title:** Find the title input field (usually near the top) and type the title using `act` with kind="type"

**Body:** Find the main text area and type the body content. For longer content, consider pasting with `paste` action.

**Images (if provided):**

1. Find the upload area (usually a "Choose File" button or drag-drop zone)
2. For local images, use the file upload dialog:
   - Use `act` with kind="click" on the upload button
   - Use `act` with kind="type" on the file input to set the file path (may need to handle multiple files)
   - Or use `upload` action if available
3. For remote images, download them first then upload

### Step 4: Publish

1. Find the publish button (usually labeled "发布" or "发布笔记")
2. Click it using `act` with kind="click"
3. Wait for confirmation (success message or redirect)
4. Inform user that the post was published successfully, include the post URL if available

## Scripts

### `scripts/publish_xiaohongshu.py`

A Python script that handles the browser automation steps above. It uses Playwright to control the browser directly, which can be more reliable than step-by-step `act` calls.

**Usage:**

```bash
python scripts/publish_xiaohongshu.py --title "标题" --body "内容" --images image1.jpg image2.jpg
```

**Features:**

- Waits for elements to load
- Handles file uploads
- Returns the final post URL
- Error handling for common issues (login required, upload failed)

If this script is present, prefer using it via `exec` with pty=true for reliability.

## References

### `references/page_structure.md`

Contains the current DOM structure of the Xiaohongshu creator platform, updated periodically. Includes selectors for key elements:

- Upload图文 button
- Title input field
- Body textarea
- Image upload area
- Publish button
- Success indicators

Use this reference when the script fails or when selectors need updating.

## Examples

### Example 1: Basic Text Post

**User:** "发小红书：标题『测试』正文：这是一条测试内容"

**Skill execution:**

1. Open creator platform
2. Click "上传图文"
3. Type title "测试"
4. Type body "这是一条测试内容"
5. Click publish
6. Confirm success

### Example 2: Post with Images

**User:** "小红书发布助手，标题『我的猫』正文：看看我家主子 图片：C:\\photos\\cat1.jpg, C:\\photos\\cat2.jpg"

**Skill execution:**

1. Same as above, but after filling text, upload both images
2. Wait for uploads to complete
3. Publish

### Example 3: Handle Missing Login

**User:** "发小红书：标题『测试』正文：测试"

**If not logged in:**

1. Detect login required
2. Respond: "请先在小红书创作平台手动登录，然后告诉我继续"
3. User logs in, says "继续"
4. Resume from Step 2

## Error Handling

| Error                   | Detection                          | Handling                                                              |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| Not logged in           | Snapshot shows login button/prompt | Ask user to log in manually, then resume                              |
| Upload failed           | Script timeout or error            | Retry up to 3 times, then inform user                                 |
| Element not found       | Snapshot missing expected refs     | Refresh page, if still missing, ask user to navigate manually         |
| Publish button disabled | Snapshot shows button disabled     | Check for missing required fields (title/body/images) and prompt user |

## Notes

- This skill relies on the stability of Xiaohongshu's web interface. If the site updates, the skill may need maintenance.
- Always prefer using the Python script for reliability; fall back to step-by-step browser actions if script fails.
- Respect platform posting limits; avoid too-frequent posts.
- Never store user passwords; rely on manual login and session persistence.
