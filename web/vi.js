/* 介面越南文：在每段繁體中文下方加上越南文（KVi） */
(function (root) {
  'use strict';

  // 介面用語。整句優先，其次以詞組替換（長的先比對）；替換後仍有中文就不顯示，避免半翻譯。
  const DICT = [
    // 導覽 / 共用
    ['廚房 SOP 食譜', 'Công thức SOP nhà bếp'], ['廚房 SOP', 'Bếp SOP'], ['食譜', 'Công thức'], ['備料單', 'Phiếu sơ chế'],
    ['小抄', 'Thẻ ghi nhớ'], ['單價表', 'Bảng đơn giá'], ['設定', 'Cài đặt'], ['載入中…', 'Đang tải…'],
    ['← 食譜', '← Công thức'], ['💡 恆亮', '💡 Giữ sáng'], ['🖨 列印小抄', '🖨 In thẻ ghi nhớ'], ['🖨 列印', '🖨 In'],
    ['＋ 備料單', '＋ Phiếu sơ chế'], ['📝 做成小抄', '📝 Tạo thẻ ghi nhớ'], ['📝 小抄', '📝 Thẻ ghi nhớ'],
    ['複製', 'Sao chép'], ['編輯', 'Sửa'], ['儲存', 'Lưu'], ['取消', 'Hủy'], ['確定', 'Đồng ý'], ['刪除', 'Xóa'],
    ['移除', 'Gỡ bỏ'], ['清空', 'Xóa hết'], ['關閉', 'Đóng'], ['繼續', 'Tiếp tục'], ['暫停', 'Tạm dừng'], ['上移', 'Lên'], ['下移', 'Xuống'],
    ['加入', 'Thêm'], ['全部', 'Tất cả'], ['其他', 'Khác'], ['或', 'hoặc'], ['換算', 'Quy đổi'],
    ['烹調時保持螢幕不關閉', 'Giữ màn hình luôn sáng khi nấu'],

    // 食譜列表
    ['搜尋食譜或食材…', 'Tìm công thức hoặc nguyên liệu…'], ['＋ 新增食譜', '＋ Thêm công thức'], ['＋ 新增第一個食譜', '＋ Thêm công thức đầu tiên'],
    ['還沒有任何食譜。', 'Chưa có công thức nào.'], ['沒有符合的食譜。', 'Không có công thức phù hợp.'], ['載入範例食譜', 'Tải công thức mẫu'],
    ['找不到這個食譜，可能已被刪除。', 'Không tìm thấy công thức này, có thể đã bị xóa.'], ['回食譜列表', 'Về danh sách công thức'],
    ['讀取資料檔失敗，為避免覆蓋原本資料，目前不會儲存任何變更。請關閉程式並檢查資料檔。', 'Đọc tệp dữ liệu thất bại. Để tránh ghi đè dữ liệu cũ, hiện sẽ không lưu thay đổi nào. Hãy đóng chương trình và kiểm tra tệp dữ liệu.'],

    // 食譜檢視
    ['倍數可輸入 2、1.5，或用「/3」「÷3」「1/3」表示除以幾倍。也可以點食材旁的 ⚖，輸入手邊現有的量，自動反推倍數。',
      'Hệ số có thể nhập 2, 1.5, hoặc dùng “/3” “÷3” “1/3” để chia. Cũng có thể bấm ⚖ cạnh nguyên liệu, nhập lượng đang có để tự tính ngược hệ số.'],
    ['以這個食材現有的量換算倍數', 'Tính hệ số theo lượng nguyên liệu này đang có'], ['計時合計約', 'tổng thời gian hẹn giờ khoảng'],
    ['基準份量', 'Khẩu phần chuẩn'], ['目標份量', 'Khẩu phần mục tiêu'], ['單位顯示', 'Hiển thị đơn vị'], ['清除勾選', 'Bỏ đánh dấu'],
    ['SOP 步驟', 'Các bước SOP'], ['尚未建立步驟。', 'Chưa có bước nào.'], ['尚未建立食材。', 'Chưa có nguyên liệu nào.'],
    ['⏱ 計時', '⏱ Hẹn giờ'], ['已備好', 'Đã chuẩn bị'], ['列印時間', 'Thời gian in'], ['倍數已設為 ×', 'Đã đặt hệ số ×'], ['倍數 ×', 'Hệ số ×'],
    ['食材成本', 'Chi phí nguyên liệu'], ['食材總成本', 'Tổng chi phí nguyên liệu'], ['到單價表設定', 'Cài trong bảng đơn giá'],
    ['項食材沒有單價或單位不符，未計入成本。', 'nguyên liệu chưa có đơn giá hoặc sai đơn vị, chưa tính vào chi phí.'],
    ['項食材缺少單價或單位不符，未完整計入。', 'nguyên liệu thiếu đơn giá hoặc sai đơn vị, chưa tính đủ.'],
    ['單價表沒有這個食材', 'Bảng đơn giá chưa có nguyên liệu này'], ['無單價', 'Chưa có giá'], ['單位不符', 'Sai đơn vị'], ['單價表單位為', 'Đơn vị trong bảng giá là'],
    ['，無法換算', ', không quy đổi được'], ['（基準份量）', '(khẩu phần chuẩn)'], ['（部分未計）', '(chưa tính đủ)'],
    ['食譜基準用量：', 'Lượng chuẩn trong công thức:'], ['請輸入手邊現有（或要使用）的量：', 'Nhập lượng đang có (hoặc muốn dùng):'],
    ['例如 3 kg、5 台斤、12', 'Ví dụ 3 kg, 5 cân Đài, 12'], ['可輸入不同單位（如 kg、台斤），只填數字則視為', 'Có thể nhập đơn vị khác (như kg, cân Đài); chỉ nhập số thì coi là'],
    ['看不懂這個數量', 'Không hiểu số lượng này'], ['無法換算成', 'không quy đổi được sang'], ['同單位', 'cùng đơn vị'],
    ['已開始計時', 'Đã bắt đầu hẹn giờ'], ['時間到！', 'Hết giờ!'], ['加 1 分鐘', 'Thêm 1 phút'], ['螢幕將保持恆亮', 'Màn hình sẽ luôn sáng'],
    ['已取消螢幕恆亮', 'Đã tắt giữ sáng màn hình'], ['此裝置不支援螢幕恆亮', 'Thiết bị này không hỗ trợ giữ sáng màn hình'],
    ['已加入備料單（×', 'Đã thêm vào phiếu sơ chế (×'], ['（複本）', '(bản sao)'],

    // 編輯
    ['新增食譜', 'Thêm công thức'], ['編輯食譜', 'Sửa công thức'], ['食譜名稱 *', 'Tên công thức *'], ['例如：古早味滷肉', 'Ví dụ: thịt kho kiểu xưa'],
    ['主菜、湯品、醬料…', 'Món chính, món canh, nước sốt…'], ['份、人份、碗、kg…', 'phần, suất, tô, kg…'], ['份量單位', 'Đơn vị khẩu phần'],
    ['選擇照片', 'Chọn ảnh'], ['照片', 'Ảnh'], ['批次貼上食材', 'Dán hàng loạt nguyên liệu'], ['批次貼上步驟', 'Dán hàng loạt các bước'], ['批次貼上', 'Dán hàng loạt'],
    ['食材名稱', 'Tên nguyên liệu'], ['備註（切丁、適量…）', 'Ghi chú (thái hạt lựu, vừa đủ…)'], ['＋ 新增食材', '＋ Thêm nguyên liệu'], ['＋ 新增步驟', '＋ Thêm bước'],
    ['數量可填 1.5、1/2、1 1/2；留空代表「適量」，不參與倍數計算。分組可區分「醃料」「醬汁」等。',
      'Số lượng có thể nhập 1.5, 1/2, 1 1/2; để trống nghĩa là “vừa đủ”, không nhân theo hệ số. Nhóm dùng để chia “ướp”, “nước sốt”…'],
    ['有填「計時」的步驟會出現計時按鈕；「重點」會以紅色標示（例如溫度、衛生、關鍵火候）。',
      'Bước có nhập “hẹn giờ” sẽ có nút hẹn giờ; “quan trọng” được tô đỏ (ví dụ nhiệt độ, vệ sinh, lửa then chốt).'],
    ['步驟說明', 'Mô tả bước'], ['計時(分)', 'Hẹn giờ (phút)'], ['保存方式、出餐注意事項…', 'Cách bảo quản, lưu ý khi ra món…'],
    ['刪除此食譜', 'Xóa công thức này'], ['刪除食譜', 'Xóa công thức'], ['確定要刪除', 'Chắc chắn xóa'], ['嗎？此動作無法復原。', '? Thao tác này không thể hoàn tác.'],
    ['每行一項，格式：「名稱 數量 單位 備註」，例如：', 'Mỗi dòng một mục, dạng: “tên số_lượng đơn_vị ghi_chú”, ví dụ:'],
    ['每行一個步驟；行內含「10 分鐘」會自動帶入計時。', 'Mỗi dòng một bước; dòng có “10 分鐘” sẽ tự điền hẹn giờ.'],
    ['請填寫食譜名稱', 'Hãy nhập tên công thức'], ['基準份量必須是大於 0 的數字', 'Khẩu phần chuẩn phải là số lớn hơn 0'],
    ['項食材的數量', 'nguyên liệu, số lượng'], ['無法辨識', 'không nhận dạng được'], ['項食材缺少名稱', 'nguyên liệu thiếu tên'], ['步的計時無法辨識', 'bước: hẹn giờ không nhận dạng được'],
    ['已儲存', 'Đã lưu'], ['已刪除', 'Đã xóa'], ['無法讀取圖片', 'Không đọc được ảnh'], ['上傳照片失敗', 'Tải ảnh lên thất bại'],
    ['食譜有尚未儲存的變更，確定要離開嗎？', 'Công thức có thay đổi chưa lưu, chắc chắn rời đi?'], ['確定要放棄尚未儲存的變更嗎？', 'Chắc chắn bỏ các thay đổi chưa lưu?'],
    ['放棄變更', 'Bỏ thay đổi'], ['放棄', 'Bỏ'], ['未命名食譜', 'Công thức chưa đặt tên'],
    ['🌐 翻譯越南文', '🌐 Dịch sang tiếng Việt'], ['越南文', 'Tiếng Việt'], ['翻譯中…', 'Đang dịch…'], ['已翻譯', 'Đã dịch'], ['翻譯失敗：', 'Dịch thất bại:'],
    ['需要先連線 Google 雲端才能自動翻譯', 'Cần kết nối Google trước để dịch tự động'], ['沒有需要翻譯的內容', 'Không có nội dung cần dịch'],
    ['越南文欄位留空會在儲存時自動翻譯（需連線 Google 雲端），也可以自己修改。', 'Ô tiếng Việt để trống sẽ tự dịch khi lưu (cần kết nối Google), cũng có thể tự sửa.'],

    // 備料單
    ['把今天要做的菜加進來並設定倍數，系統會自動合併相同食材的總用量與成本，方便叫貨與備料。',
      'Thêm các món hôm nay và đặt hệ số, hệ thống tự cộng gộp tổng lượng và chi phí của nguyên liệu giống nhau, tiện đặt hàng và sơ chế.'],
    ['菜色與倍數', 'Món và hệ số'], ['尚未加入菜色。', 'Chưa thêm món nào.'], ['＋ 加入', '＋ Thêm'], ['合計食材', 'Tổng nguyên liệu'],
    ['加入菜色後會顯示合計。', 'Thêm món để xem tổng.'], ['清空備料單', 'Xóa phiếu sơ chế'], ['確定要清空備料單嗎？（食譜不會被刪除）', 'Chắc chắn xóa phiếu sơ chế? (Công thức không bị xóa)'],
    ['＋適量', '＋vừa đủ'],

    // 小抄
    ['把食譜依倍數濃縮成精簡卡片（份量、食材用量、重點步驟），列印後可剪下貼在工作台；也能加自訂文字卡。',
      'Rút gọn công thức theo hệ số thành thẻ ngắn (khẩu phần, lượng nguyên liệu, bước quan trọng), in ra cắt dán ở bàn làm việc; có thể thêm thẻ chữ tự viết.'],
    ['卡片標題（例如：出餐順序、注意事項）', 'Tiêu đề thẻ (ví dụ: thứ tự ra món, lưu ý)'], ['內容，一行一點', 'Nội dung, mỗi dòng một ý'], ['卡片', 'Thẻ'],
    ['尚未加入卡片。', 'Chưa có thẻ nào.'], ['＋ 食譜', '＋ Công thức'], ['＋ 文字卡', '＋ Thẻ chữ'], ['從備料單匯入', 'Lấy từ phiếu sơ chế'],
    ['內容與版面', 'Nội dung và bố cục'], ['食材用量', 'Lượng nguyên liệu'], ['食譜備註', 'Ghi chú công thức'], ['只列重點步驟', 'Chỉ bước quan trọng'],
    ['全部步驟', 'Tất cả các bước'], ['不列步驟', 'Không ghi bước'], ['版面', 'Bố cục'], ['兩欄小卡', 'Thẻ nhỏ hai cột'], ['單欄', 'Một cột'],
    ['一頁一張', 'Mỗi trang một thẻ'], ['字級', 'Cỡ chữ'], ['（尚未填寫內容）', '(chưa có nội dung)'], ['（沒有勾選要顯示的內容）', '(chưa chọn nội dung hiển thị)'],
    ['清空小抄', 'Xóa thẻ ghi nhớ'], ['確定要清空所有小抄卡片嗎？（食譜不會被刪除）', 'Chắc chắn xóa tất cả thẻ ghi nhớ? (Công thức không bị xóa)'],
    ['這道菜已經在小抄裡了', 'Món này đã có trong thẻ ghi nhớ'],

    // 單價表
    ['食材單價表', 'Bảng đơn giá nguyên liệu'], ['食材名稱需與食譜中的名稱相同才會計算成本。單位可與食譜不同，例如單價用「台斤」、食譜用「g」會自動換算。',
      'Tên nguyên liệu phải giống tên trong công thức mới tính chi phí. Đơn vị có thể khác công thức, ví dụ giá theo “cân Đài”, công thức dùng “g” sẽ tự quy đổi.'],
    ['搜尋食材…', 'Tìm nguyên liệu…'], ['＋ 新增', '＋ Thêm'], ['從食譜帶入食材', 'Lấy nguyên liệu từ công thức'], ['所有食材都已在單價表中', 'Tất cả nguyên liệu đã có trong bảng giá'],
    ['已帶入', 'Đã thêm'], ['項食材，請填寫價格', 'nguyên liệu, hãy nhập giá'], ['價格（元）', 'Giá (đồng)'], ['價格', 'Giá'], ['換算單價', 'Đơn giá quy đổi'],
    ['未使用', 'Chưa dùng'], ['尚無資料。', 'Chưa có dữ liệu.'],

    // 設定
    ['設定與資料', 'Cài đặt và dữ liệu'], ['倍數換算後的單位顯示方式', 'Cách hiển thị đơn vị sau khi nhân hệ số'], ['單位對照表', 'Bảng quy đổi đơn vị'],
    ['顆、包、把等計數單位會直接乘以倍數，不做換算。', 'Đơn vị đếm như quả, gói, bó sẽ nhân thẳng theo hệ số, không quy đổi.'],
    ['自動（g↔kg、ml↔L）', 'Tự động (g↔kg, ml↔L)'], ['保留原單位', 'Giữ đơn vị gốc'], ['全部換成公制', 'Đổi hết sang hệ mét'], ['台制（台斤／兩）', 'Hệ Đài (cân Đài / lạng)'],
    ['☁ Google 雲端同步', '☁ Đồng bộ Google'], ['已連線到你的 Google 試算表（即時同步）：修改約 1 秒內上傳，其他裝置約 10 秒內更新。',
      'Đã kết nối Google Sheets của bạn (đồng bộ tức thì): thay đổi tải lên trong khoảng 1 giây, thiết bị khác cập nhật trong khoảng 10 giây.'],
    ['立即同步', 'Đồng bộ ngay'], ['中斷連線', 'Ngắt kết nối'], ['中斷雲端連線', 'Ngắt kết nối đám mây'],
    ['把資料存到你自己的 Google 試算表，手機、平板、電腦版都讀寫同一份。', 'Lưu dữ liệu vào Google Sheets của bạn, điện thoại, máy tính bảng, máy tính cùng đọc ghi một bản.'],
    ['設定方式請看', 'Cách cài đặt xem tại'], ['雲端設定說明', 'Hướng dẫn cài đặt đám mây'], ['Apps Script 網頁應用程式網址', 'Địa chỉ ứng dụng web Apps Script'],
    ['存取密碼', 'Mật khẩu truy cập'], ['至少 6 個字；第一次連線時輸入的密碼會成為雲端的存取密碼', 'Ít nhất 6 ký tự; mật khẩu nhập lần kết nối đầu sẽ thành mật khẩu đám mây'],
    ['連線中…', 'Đang kết nối…'], ['連線', 'Kết nối'], ['備份與還原', 'Sao lưu và khôi phục'], ['匯出的 JSON 檔可在手機版與電腦版之間互相匯入。', 'Tệp JSON xuất ra có thể nhập qua lại giữa bản điện thoại và bản máy tính.'],
    ['⬇ 匯出備份', '⬇ Xuất sao lưu'], ['⬆ 匯入備份', '⬆ Nhập sao lưu'], ['匯入備份', 'Nhập sao lưu'], ['危險區', 'Vùng nguy hiểm'], ['清除全部資料', 'Xóa toàn bộ dữ liệu'],
    ['廚房 SOP 食譜及倍數計算系統', 'Hệ thống công thức SOP nhà bếp và tính hệ số'], ['（Windows 版）', '(bản Windows)'], ['（網頁版）', '(bản web)'],
    ['資料檔：', 'Tệp dữ liệu:'], ['資料已設定為持久保存於此裝置。', 'Dữ liệu được lưu lâu dài trên thiết bị này.'],
    ['資料儲存在此瀏覽器中，清除瀏覽資料會一併刪除，請定期匯出備份。', 'Dữ liệu lưu trong trình duyệt này, xóa dữ liệu duyệt web sẽ mất theo, hãy xuất sao lưu định kỳ.'],
    ['已匯出：', 'Đã xuất:'], ['檔案不是有效的 JSON 備份', 'Tệp không phải bản sao lưu JSON hợp lệ'], ['這不是廚房 SOP 的備份檔', 'Đây không phải tệp sao lưu của Bếp SOP'],
    ['備份內含', 'Bản sao lưu có'], ['筆單價。', 'đơn giá.'], ['合併兩邊', 'Gộp hai bên'], ['合併', 'Gộp'], ['全部取代', 'Thay thế toàn bộ'],
    ['保留現有資料，相同食譜（同 ID）與同名單價以備份覆蓋。', 'Giữ dữ liệu hiện có, công thức trùng (cùng ID) và đơn giá trùng tên sẽ bị bản sao lưu ghi đè.'],
    ['刪除目前所有資料，改用備份內容。', 'Xóa toàn bộ dữ liệu hiện tại, dùng nội dung bản sao lưu.'], ['匯入完成（', 'Nhập xong ('],
    ['範例食譜已經存在', 'Công thức mẫu đã có'], ['道範例食譜', 'công thức mẫu'], ['將刪除所有食譜、單價與備料單，', 'Sẽ xóa tất cả công thức, đơn giá và phiếu sơ chế,'],
    ['無法復原', 'không thể hoàn tác'], ['。建議先匯出備份。', '. Nên xuất sao lưu trước.'], ['請輸入「清除」確認：', 'Nhập “清除” để xác nhận:'], ['已清除全部資料', 'Đã xóa toàn bộ dữ liệu'],
    ['輸入不符，未清除', 'Nhập không khớp, chưa xóa'], ['清除全部', 'Xóa toàn bộ'], ['清除', 'Xóa'],
    ['🌐 翻譯全部食譜', '🌐 Dịch tất cả công thức'], ['介面與食譜越南文', 'Tiếng Việt cho giao diện và công thức'],
    ['在每段中文下方顯示越南文（只影響這台裝置）。食譜內容會用 Google 翻譯自動產生越南文，可在編輯食譜時修改。',
      'Hiện tiếng Việt dưới mỗi đoạn tiếng Trung (chỉ trên thiết bị này). Nội dung công thức được Google dịch tự động, có thể sửa khi chỉnh công thức.'],
    ['顯示越南文', 'Hiện tiếng Việt'], ['全部食譜都已有越南文', 'Tất cả công thức đã có tiếng Việt'],

    // 雲端
    ['已同步', 'Đã đồng bộ'], ['同步中', 'Đang đồng bộ'], ['同步失敗：', 'Đồng bộ thất bại:'], ['同步失敗', 'Đồng bộ thất bại'], ['待同步', 'Chờ đồng bộ'],
    ['上次同步：', 'Lần đồng bộ trước:'], ['上次同步', 'Lần đồng bộ trước'], ['已連線 Google 雲端', 'Đã kết nối Google'],
    ['已連線，並設定了雲端存取密碼；其他裝置請輸入同一組密碼', 'Đã kết nối và đặt mật khẩu đám mây; thiết bị khác hãy nhập cùng mật khẩu'],
    ['雲端已有資料', 'Đám mây đã có dữ liệu'], ['雲端有', 'Đám mây có'], ['道食譜，這台裝置有', 'công thức, thiết bị này có'], ['道。要怎麼處理？', 'công thức. Xử lý thế nào?'],
    ['道食譜、', 'công thức,'], ['下載雲端', 'Tải từ đám mây'], ['上傳本機', 'Tải lên từ máy này'],
    ['用雲端資料取代這台的資料。', 'Dùng dữ liệu đám mây thay cho dữ liệu máy này.'], ['兩邊的食譜都保留，同一道以較新的為準。', 'Giữ công thức của cả hai bên, món trùng lấy bản mới hơn.'],
    ['用這台的資料覆蓋雲端。', 'Dùng dữ liệu máy này ghi đè đám mây.'], ['這台裝置將不再與 Google 試算表同步（雲端與本機的資料都會保留）。', 'Thiết bị này sẽ ngừng đồng bộ với Google Sheets (dữ liệu đám mây và máy này đều được giữ).'],
    ['請貼上 Apps Script 網頁應用程式網址（https://script.google.com/…/exec）', 'Hãy dán địa chỉ ứng dụng web Apps Script (https://script.google.com/…/exec)'],
    ['請輸入存取密碼', 'Hãy nhập mật khẩu truy cập'], ['已設定，但同步失敗：', 'Đã cài đặt nhưng đồng bộ thất bại:'], ['連線失敗：', 'Kết nối thất bại:'],
    ['目前沒有網路', 'Hiện không có mạng'], ['連線逾時', 'Kết nối quá thời gian'], ['無法連線到 Google', 'Không kết nối được Google'],
    ['回應格式不對：請確認是「網頁應用程式」的 /exec 網址，且存取權為「所有人」', 'Phản hồi sai định dạng: hãy kiểm tra đúng địa chỉ /exec của “ứng dụng web” và quyền truy cập là “mọi người”'],
    ['雲端發生錯誤', 'Lỗi trên đám mây'], ['雲端存取密碼錯誤，請到設定重新連線', 'Sai mật khẩu đám mây, hãy vào Cài đặt kết nối lại'],
    ['讀取資料失敗：', 'Đọc dữ liệu thất bại:'], ['儲存失敗：', 'Lưu thất bại:'], ['寫入檔案失敗', 'Ghi tệp thất bại'], ['存取密碼錯誤', 'Sai mật khẩu truy cập'],

    // 詞組（組句用）
    ['項食材', 'nguyên liệu'], ['個步驟', 'bước'], ['項無單價', 'mục chưa có giá'], ['道食譜', 'công thức'], ['已加入', 'Đã thêm'],
    ['食材', 'Nguyên liệu'], ['步驟', 'Bước'], ['重點', 'Quan trọng'], ['備註', 'Ghi chú'], ['成本', 'Chi phí'], ['份量', 'Khẩu phần'], ['倍數', 'Hệ số'],
    ['分類', 'Phân loại'], ['分組', 'Nhóm'], ['數量', 'Số lượng'], ['單位', 'Đơn vị'], ['基準', 'chuẩn'], ['計時', 'Hẹn giờ'], ['共', 'Tổng'],
    ['第', 'thứ'], ['約', 'khoảng'], ['每', 'mỗi'], ['原', 'gốc'], ['有', 'có'], ['項', 'mục'], ['步', 'bước'],
    ['上午', 'sáng'], ['下午', 'chiều'], ['小', 'Nhỏ'], ['中', 'Vừa'], ['大', 'Lớn'], ['以', 'theo'], ['｜步驟', '｜Bước'], ['把', 'bó'],

    // 單位
    ['台斤', 'cân Đài'], ['米杯', 'cốc gạo'], ['大匙', 'muỗng canh'], ['小匙', 'muỗng cà phê'], ['人份', 'suất'], ['分鐘', 'phút'], ['適量', 'vừa đủ'],
    ['兩', 'lạng'], ['杯', 'cốc'], ['顆', 'quả'], ['個', 'cái'], ['片', 'lát'], ['條', 'cây'], ['根', 'cây'], ['包', 'gói'], ['罐', 'lon'], ['瓶', 'chai'],
    ['盒', 'hộp'], ['隻', 'con'], ['尾', 'con'], ['瓣', 'tép'], ['粒', 'hạt'], ['張', 'tờ'], ['份', 'phần'], ['碗', 'tô'], ['盤', 'đĩa'], ['鍋', 'nồi'], ['分', 'phút'],

    // 常見分類與食材（食譜還沒翻譯時的備援）
    ['主菜', 'Món chính'], ['湯品', 'Món canh'], ['醬料', 'Nước sốt'], ['滷汁', 'Nước kho'], ['醬汁', 'Nước sốt'], ['醃料', 'Gia vị ướp'],
    ['水', 'Nước'], ['鹽', 'Muối'], ['糖', 'Đường'], ['醬油', 'Nước tương'], ['米酒', 'Rượu gạo'], ['冰糖', 'Đường phèn'], ['高湯', 'Nước dùng'],
    ['雞蛋', 'Trứng gà'], ['蒜頭', 'Tỏi'], ['蒜末', 'Tỏi băm'], ['辣椒', 'Ớt'], ['九層塔', 'Húng quế'], ['蔥花', 'Hành lá thái nhỏ'],
  ];

  const MAP = new Map(DICT.map(([z, v]) => [z, v]));
  const keys = [...MAP.keys()].sort((a, b) => b.length - a.length);
  const RE = new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const HAN = /[㐀-鿿]/;
  const PUNCT = { '，': ', ', '。': '. ', '：': ': ', '、': ', ', '；': '; ', '！': '! ', '？': '? ', '（': ' (', '）': ') ', '「': '“', '」': '”', '　': ' ', '／': ' / ', '…': '…' };

  /** 中文介面字串 → 越南文；無法完整翻譯時回傳 '' */
  function tr(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s || !HAN.test(s)) return '';
    if (MAP.has(s)) return MAP.get(s);
    let hit = false;
    // 「…」裡是食譜名稱等使用者內容：原樣保留
    let out = s.split(/(「[^」]*」)/).map(part => (part.charAt(0) === '「' ? part
      : part.replace(RE, m => { hit = true; const v = MAP.get(m); return ' ' + v.charAt(0).toLowerCase() + v.slice(1) + ' '; }))).join('');
    if (!hit) return '';
    // 「…」裡的中文是食譜名稱等使用者內容，可以留著；其他地方還有中文就放棄
    if (HAN.test(out.replace(/「[^」]*」/g, ''))) return '';
    out = out.replace(/[，。：、；！？（）「」　／]/g, c => PUNCT[c]).replace(/\s+([,.:;!?)”])/g, '$1').replace(/([(“])\s+/g, '$1').replace(/\s{2,}/g, ' ').trim();
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  // ---------------------------------------------------------------- 套用到畫面
  let on = true;
  try { on = localStorage.getItem('ksop.vi') !== '0'; } catch (e) { /* 無法存取時預設開啟 */ }
  const SKIP = 'script,style,textarea,select,code,.vi,.bi,[data-novi]';
  const ATTRS = ['placeholder', 'title', 'aria-label'];

  function wrapText(node) {
    const p = node.parentElement;
    if (!p || p.closest(SKIP)) return;
    const v = tr(node.data);
    if (!v) return;
    const bi = document.createElement('span');
    bi.className = 'bi';
    const vi = document.createElement('span');
    vi.className = 'vi'; vi.lang = 'vi'; vi.textContent = v;
    p.replaceChild(bi, node);
    bi.append(node, vi);
  }
  function doAttrs(el) {
    for (const a of ATTRS) {
      const t = el.getAttribute(a);
      const v = t && !t.includes(' / ') && tr(t);
      if (v) el.setAttribute(a, `${t} / ${v}`);
    }
    if (el.tagName === 'OPTION' && !el.text.includes(' / ')) { const v = tr(el.text); if (v) el.text = `${el.text} / ${v}`; }
  }
  function apply(rootEl) {
    if (!on || !rootEl) return;
    if (rootEl.nodeType === 3) { if (HAN.test(rootEl.data)) wrapText(rootEl); return; }
    if (rootEl.nodeType !== 1 || rootEl.closest('.vi,.bi,[data-novi]')) return;
    const els = [rootEl, ...rootEl.querySelectorAll('[placeholder],[title],[aria-label],option')];
    els.forEach(el => { if (el.matches && el.matches('[placeholder],[title],[aria-label],option')) doAttrs(el); });
    const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, { acceptNode: n => (HAN.test(n.data) ? 1 : 3) });
    const list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(wrapText);
  }
  function start() {
    document.documentElement.classList.toggle('vi-on', on);
    if (!on) return;
    apply(document.body);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'attributes') { if (!m.target.closest('[data-novi]')) doAttrs(m.target); continue; }
        if (m.type === 'characterData') { if (!m.target.parentElement || !m.target.parentElement.closest('.bi')) apply(m.target); continue; }
        m.addedNodes.forEach(apply);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  /** 給 confirm()/prompt() 之類的原生對話框用 */
  const both = s => { const v = on && tr(s); return v ? `${s}\n${v}` : s; };
  function setOn(v) { try { localStorage.setItem('ksop.vi', v ? '1' : '0'); } catch (e) { /* ignore */ } location.reload(); }

  root.KVi = { tr, start, both, setOn, get on() { return on; } };
})(typeof self !== 'undefined' ? self : this);
