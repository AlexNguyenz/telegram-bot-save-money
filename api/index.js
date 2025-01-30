require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
  console.error('Lỗi: Không tìm thấy TELEGRAM_TOKEN');
  process.exit(1);
}

const bot = new TelegramBot(token);
bot.setWebHook("https://telegram-bot-save-money.vercel.app/api")

// Thư mục lưu trữ file Excel của từng user
const userDataDir = path.resolve("/tmp", '../users');
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir); // Tạo thư mục nếu chưa tồn tại
}

// Hàm lấy đường dẫn file của từng user
function getUserFilePath(chatId) {
  return path.resolve(userDataDir, `expenses_${chatId}.xlsx`);
}

// Hàm tạo file Excel nếu chưa có
function ensureUserFileExists(chatId) {
  const filePath = getUserFilePath(chatId);
  if (!fs.existsSync(filePath)) {
    const workbook = xlsx.utils.book_new();
    const worksheetData = [['ID', 'Tên khoản chi', 'Số tiền', 'Danh mục', 'Ngày tháng']];
    const worksheet = xlsx.utils.aoa_to_sheet(worksheetData);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Template');
    xlsx.writeFile(workbook, filePath);
  }
  return filePath;
}

// Hàm lấy tên sheet từ ngày tháng
function getSheetNameFromDate(dateString) {
  const [day, month, year] = dateString.split('-');
  return `T${month.padStart(2, '0')}-${year}`;
}

// Hàm đọc dữ liệu từ file Excel
function readUserExpenses(chatId, sheetName) {
  const filePath = ensureUserFileExists(chatId);
  const workbook = xlsx.readFile(filePath);
  const worksheet = workbook.Sheets[sheetName];
  return worksheet ? xlsx.utils.sheet_to_json(worksheet) : [];
}

// Hàm ghi dữ liệu vào sheet
function writeUserExpenses(chatId, sheetName, data) {
  const filePath = ensureUserFileExists(chatId);
  const workbook = xlsx.readFile(filePath);
  if (!workbook.Sheets[sheetName]) {
    const worksheet = xlsx.utils.aoa_to_sheet([['ID', 'Tên khoản chi', 'Số tiền', 'Danh mục', 'Ngày tháng']]);
    xlsx.utils.book_append_sheet(workbook, worksheet, sheetName);
  }
  const existingData = readUserExpenses(chatId, sheetName);
  existingData.push(data);
  const newWorksheet = xlsx.utils.json_to_sheet(existingData);
  workbook.Sheets[sheetName] = newWorksheet;
  xlsx.writeFile(workbook, filePath);
}

// Hàm tạo ID duy nhất
function generateId() {
  return Date.now().toString();
}

// Hàm gửi file Excel cho user
function sendUserExcelFile(chatId) {
  const filePath = getUserFilePath(chatId);
  bot.sendDocument(chatId, filePath);
}

// Hàm tính tổng chi tiêu
function calculateTotalExpenses(expenses, category = 'all') {
  let total = 0;
  expenses.forEach((expense) => {
    if (category === 'all' || expense['Danh mục'] === category) {
      total += parseFloat(expense['Số tiền']);
    }
  });
  return `${new Intl.NumberFormat('vi-VN').format(total)} ₫`;
}

// Lệnh /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Chào mừng bạn đến với bot quản lý chi tiêu! Gõ /help để xem các lệnh có sẵn.');
});

// Lệnh /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, `
Các lệnh có sẵn:
/add - Thêm một khoản chi mới
/view - Xem tất cả các khoản chi
/edit - Sửa một khoản chi
/delete - Xóa một khoản chi
/export - Xuất file Excel
/stats - Xem thống kê chi tiêu
  `);
});

// Lệnh /add
bot.onText(/\/add/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Nhập thông tin khoản chi: Tên khoản chi, Số tiền, Danh mục, Ngày tháng (dd-mm-yyyy)');
  bot.once('message', (msg) => {
    const [name, amount, category, dateString] = msg.text.split(', ');
    const sheetName = getSheetNameFromDate(dateString);
    const newExpense = { ID: generateId(), 'Tên khoản chi': name, 'Số tiền': amount, 'Danh mục': category, 'Ngày tháng': dateString };
    writeUserExpenses(chatId, sheetName, newExpense);
    bot.sendMessage(chatId, `Đã thêm khoản chi vào ${sheetName}.`);
  });
});

// Lệnh /view
bot.onText(/\/view/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Nhập tháng và năm (mm-yyyy):');
  bot.once('message', (msg) => {
    const sheetName = `T${msg.text}`;
    const expenses = readUserExpenses(chatId, sheetName);
    if (expenses.length === 0) {
      bot.sendMessage(chatId, `Không có dữ liệu cho tháng ${msg.text}.`);
    } else {
      let message = `Chi tiêu tháng ${msg.text}:\n`;
      expenses.forEach((expense) => {
        message += `- ${expense['Tên khoản chi']}: ${expense['Số tiền']} VND (${expense['Danh mục']}, ${expense['Ngày tháng']})\n`;
      });
      bot.sendMessage(chatId, message);
    }
  });
});

// Lệnh /delete
bot.onText(/\/delete/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Nhập tháng và năm (mm-yyyy):');
  bot.once('message', (msg) => {
    const sheetName = `T${msg.text}`;
    const expenses = readUserExpenses(chatId, sheetName);
    if (expenses.length === 0) {
      bot.sendMessage(chatId, `Không có dữ liệu cho tháng ${msg.text}.`);
    } else {
      bot.sendMessage(chatId, 'Nhập ID khoản chi cần xóa:');
      bot.once('message', (msg) => {
        const updatedExpenses = expenses.filter((expense) => expense.ID !== msg.text);
        const workbook = xlsx.readFile(getUserFilePath(chatId));
        workbook.Sheets[sheetName] = xlsx.utils.json_to_sheet(updatedExpenses);
        xlsx.writeFile(workbook, getUserFilePath(chatId));
        bot.sendMessage(chatId, 'Đã xóa khoản chi.');
      });
    }
  });
});

// Lệnh /export
bot.onText(/\/export/, (msg) => {
  sendUserExcelFile(msg.chat.id);
});

// Lệnh /stats
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Nhập tháng và năm để xem thống kê (định dạng: mm-yyyy):');
  bot.once('message', (msg) => {
    const [month, year] = msg.text.split('-');
    const formattedMonth = month.padStart(2, '0'); // Đảm bảo tháng có 2 chữ số
    const sheetName = `T${formattedMonth}-${year}`;
    
    // Đọc dữ liệu từ file riêng của user
    const expenses = readUserExpenses(chatId, sheetName);
    
    if (expenses.length === 0) {
      bot.sendMessage(chatId, `Không có khoản chi nào được ghi lại cho tháng ${formattedMonth}-${year}.`);
    } else {
      // Tính tổng chi tiêu cho tất cả các danh mục
      const totalAll = calculateTotalExpenses(expenses, 'all');

      // Lấy tất cả các danh mục có trong chi tiêu
      const categories = [...new Set(expenses.map(expense => expense['Danh mục']))];

      // Khởi tạo message sẽ gửi
      let message = `Tổng chi tiêu tháng ${formattedMonth}-${year}:\n`;
      message += `- Tổng: ${totalAll}\n`;

      // Lặp qua từng danh mục và tính tổng chi tiêu
      categories.forEach((category) => {
        if (category !== 'all') {
          const totalCategory = calculateTotalExpenses(expenses, category);
          message += `- ${category}: ${totalCategory}\n`;
        }
      });

      bot.sendMessage(chatId, message);
    }
  });
});

