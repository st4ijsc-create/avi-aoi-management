cd /d/SOURCES/_twin_wt
for f in client/public/sw.js client/public/default-machine-2d.svg client/public/aoi-upload-test-client.html client/index.html server/license/sdk/index.cjs; do
  a=$(md5sum < "$f" | cut -c1-8)
  b=$(md5sum < ".qa-dot58/src-nen/$f" | cut -c1-8)
  ca=$(tr -cd '\r' < "$f" | wc -c)
  cb=$(tr -cd '\r' < ".qa-dot58/src-nen/$f" | wc -c)
  echo "$f  worktree=$a(CR=$ca)  srcnen=$b(CR=$cb)"
done
