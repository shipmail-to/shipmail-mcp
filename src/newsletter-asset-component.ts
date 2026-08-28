export const NEWSLETTER_ASSET_UPLOADER_RESOURCE_URI =
  "ui://shipmail/newsletter-asset-uploader-v1.html";

export const NEWSLETTER_ASSET_UPLOADER_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Shipmail newsletter media</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 16px; background: transparent; color: CanvasText; }
    main { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 14px; padding: 16px; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 12px; margin: 0 0 16px; font-size: 13px; }
    dt { color: color-mix(in srgb, CanvasText 62%, transparent); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button { border: 0; border-radius: 9px; padding: 9px 13px; font: inherit; cursor: pointer; }
    button.primary { background: #0f766e; color: white; }
    button.secondary { background: color-mix(in srgb, CanvasText 10%, transparent); color: CanvasText; }
    button:disabled { cursor: wait; opacity: .58; }
    #status { min-height: 20px; margin: 12px 0 0; font-size: 13px; overflow-wrap: anywhere; }
    #status.error { color: #dc2626; }
    #status.success { color: #15803d; }
  </style>
</head>
<body>
  <main>
    <h1>Review newsletter media upload</h1>
    <dl>
      <dt>File</dt><dd id="file"></dd>
      <dt>Type</dt><dd id="type"></dd>
    </dl>
    <div class="actions">
      <button id="submit" class="primary" type="button">Upload media</button>
      <button id="change" class="secondary" type="button" hidden>Choose another file</button>
    </div>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script>
    (function () {
      var bridge = window.openai;
      var input = bridge && bridge.toolInput ? bridge.toolInput : {};
      var selectedFile = input.file || null;
      var submit = document.getElementById("submit");
      var change = document.getElementById("change");
      var status = document.getElementById("status");
      var allowedTypes = {
        "image/gif": true,
        "image/jpeg": true,
        "image/png": true,
        "image/webp": true,
        "video/mp4": true,
        "video/quicktime": true,
        "video/webm": true
      };

      function fileName(file) {
        return file && (file.file_name || file.fileName) ? (file.file_name || file.fileName) : "Selected file";
      }
      function readUrl(value) {
        if (typeof value === "string") return value;
        if (!value || typeof value !== "object") return null;
        return value.download_url || value.downloadUrl || value.url || null;
      }
      function readPreparedUpload(result) {
        var direct = result && result._meta;
        var nested = result && result.mcp_tool_result && result.mcp_tool_result._meta;
        var metadata = result && result.toolResponseMetadata;
        var structured = result && result.structuredContent && result.structuredContent.prepared_upload;
        var source = direct || nested || metadata || structured;
        if (!source || !source.upload_url || !source.complete_url) return null;
        return source;
      }
      function hasToolError(result) {
        return Boolean(result && (result.isError || result.is_error));
      }
      function bytesToHex(buffer) {
        return Array.from(new Uint8Array(buffer)).map(function (byte) {
          return byte.toString(16).padStart(2, "0");
        }).join("");
      }
      function inferContentType(file, response) {
        var declared = file && (file.mime_type || file.mimeType);
        if (declared && allowedTypes[declared.toLowerCase()]) return declared.toLowerCase();
        var responseType = response.headers.get("content-type");
        if (responseType) {
          responseType = responseType.split(";")[0].trim().toLowerCase();
          if (allowedTypes[responseType]) return responseType;
        }
        var name = fileName(file).toLowerCase();
        if (name.endsWith(".gif")) return "image/gif";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".mov")) return "video/quicktime";
        if (name.endsWith(".mp4")) return "video/mp4";
        if (name.endsWith(".webm")) return "video/webm";
        return null;
      }
      function waitForMediaEvent(element, eventName) {
        return new Promise(function (resolve, reject) {
          function cleanup() {
            element.removeEventListener(eventName, onReady);
            element.removeEventListener("error", onError);
          }
          function onReady() {
            cleanup();
            resolve();
          }
          function onError() {
            cleanup();
            reject(new Error("video_decode_failed"));
          }
          element.addEventListener(eventName, onReady, { once: true });
          element.addEventListener("error", onError, { once: true });
        });
      }
      async function createVideoPoster(bytes, contentType) {
        var objectUrl = URL.createObjectURL(new Blob([bytes], { type: contentType }));
        var video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = objectUrl;
        try {
          await waitForMediaEvent(video, "loadedmetadata");
          var seekSeconds = Number.isFinite(video.duration) && video.duration > 1 ? 1 : 0;
          if (seekSeconds > 0) {
            video.currentTime = seekSeconds;
            await waitForMediaEvent(video, "seeked");
          } else if (video.readyState < 2) {
            await waitForMediaEvent(video, "loadeddata");
          }
          var width = video.videoWidth || 1280;
          var height = video.videoHeight || 720;
          var canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          var context = canvas.getContext("2d");
          if (!context) throw new Error("canvas_unavailable");
          context.drawImage(video, 0, 0, width, height);
          var poster = await new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
              if (blob) resolve(blob);
              else reject(new Error("poster_encode_failed"));
            }, "image/jpeg", 0.86);
          });
          return await poster.arrayBuffer();
        } finally {
          video.removeAttribute("src");
          video.load();
          URL.revokeObjectURL(objectUrl);
        }
      }
      function setStatus(message, kind) {
        status.textContent = message;
        status.className = kind || "";
      }
      function setBusy(busy) {
        submit.disabled = busy;
        change.disabled = busy;
      }
      function renderFile() {
        document.getElementById("file").textContent = fileName(selectedFile);
        document.getElementById("type").textContent =
          selectedFile && (selectedFile.mime_type || selectedFile.mimeType) || "Detected during upload";
      }

      renderFile();
      if (bridge && typeof bridge.selectFiles === "function") {
        change.hidden = false;
        change.addEventListener("click", async function () {
          try {
            var files = await bridge.selectFiles();
            if (files && files[0]) {
              selectedFile = files[0];
              renderFile();
              setStatus("");
            }
          } catch (error) {
            setStatus("Could not open the file picker.", "error");
          }
        });
      }

      submit.addEventListener("click", async function () {
        if (!bridge || typeof bridge.callTool !== "function") {
          setStatus("This host cannot call Shipmail tools from the upload card. Use the raw prepared upload workflow instead.", "error");
          return;
        }
        if (!selectedFile || !(selectedFile.file_id || selectedFile.fileId)) {
          setStatus("Choose a file first.", "error");
          return;
        }

        setBusy(true);
        try {
          setStatus("Downloading the selected file...");
          var fileId = selectedFile.file_id || selectedFile.fileId;
          var downloadUrl = selectedFile.download_url || selectedFile.downloadUrl || null;
          if (typeof bridge.getFileDownloadUrl === "function") {
            try {
              var freshUrl = await bridge.getFileDownloadUrl({ fileId: fileId });
              downloadUrl = readUrl(freshUrl) || downloadUrl;
            } catch (error) {
              if (!downloadUrl) throw error;
            }
          }
          if (!downloadUrl) throw new Error("download_url_missing");
          var fileResponse = await fetch(downloadUrl, {
            method: "GET",
            credentials: "omit",
            redirect: "error"
          });
          if (!fileResponse.ok) throw new Error("download_failed");
          var bytes = await fileResponse.arrayBuffer();
          if (bytes.byteLength < 1 || bytes.byteLength > 25 * 1024 * 1024) {
            throw new Error("file_size_invalid");
          }
          var contentType = inferContentType(selectedFile, fileResponse);
          if (!contentType) throw new Error("file_type_invalid");
          if (contentType.startsWith("image/") && bytes.byteLength > 5 * 1024 * 1024) {
            throw new Error("image_size_invalid");
          }
          var digest = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
          var prepareInput = {
            filename: fileName(selectedFile),
            content_type: contentType,
            size: bytes.byteLength,
            sha256: digest
          };
          if (input.organization_id) prepareInput.organization_id = input.organization_id;

          setStatus("Preparing a one-time Shipmail upload...");
          var prepared = await bridge.callTool("shipmail_prepare_newsletter_asset_upload", prepareInput);
          if (hasToolError(prepared)) throw new Error("prepare_failed");
          var preparedUpload = readPreparedUpload(prepared);
          if (!preparedUpload) throw new Error("upload_url_missing");

          setStatus("Uploading newsletter media...");
          var upload = await fetch(preparedUpload.upload_url, {
            method: "PUT",
            body: bytes,
            credentials: "omit",
            redirect: "error",
            headers: preparedUpload.upload_headers || {
              "Content-Type": contentType,
              "If-None-Match": "*"
            }
          });
          if (!upload.ok) throw new Error("upload_failed");
          if (contentType.startsWith("video/")) {
            if (!preparedUpload.thumbnail_upload_url) throw new Error("thumbnail_upload_url_missing");
            setStatus("Preparing the video poster...");
            var posterBytes = await createVideoPoster(bytes, contentType);
            var thumbnailUpload = await fetch(preparedUpload.thumbnail_upload_url, {
              method: "PUT",
              body: posterBytes,
              credentials: "omit",
              redirect: "error",
              headers: preparedUpload.thumbnail_upload_headers || {
                "Content-Type": "image/jpeg",
                "If-None-Match": "*"
              }
            });
            if (!thumbnailUpload.ok) throw new Error("thumbnail_upload_failed");
          }

          setStatus("Verifying newsletter media...");
          var completion = await fetch(preparedUpload.complete_url, {
            method: "POST",
            credentials: "omit",
            redirect: "error"
          });
          if (!completion.ok) throw new Error("completion_failed");
          var asset = await completion.json();
          if (!asset || !asset.id || !asset.url) throw new Error("asset_missing");

          setStatus("Media uploaded as " + asset.filename + ".", "success");
          submit.hidden = true;
          change.hidden = true;
        } catch (error) {
          setStatus("The newsletter media could not be uploaded. No automatic retry was made.", "error");
        } finally {
          setBusy(false);
        }
      });
    })();
  </script>
</body>
</html>`;
