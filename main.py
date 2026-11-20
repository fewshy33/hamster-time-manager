import os
from urllib.parse import urlsplit

import telebot
from dotenv import load_dotenv
from telebot import types

BUTTON_TEXT = "🐹 Запустить Hamster Time Manager"


def create_bot(token: str, web_app_url: str) -> telebot.TeleBot:
    bot = telebot.TeleBot(token)

    @bot.message_handler(commands=["start"])
    def start(message):
        user_name = message.from_user.first_name or "друг"
        bot.send_message(
            message.chat.id,
            f"Привет, {user_name}! 👋\n"
            "Я — твой помощник по тайм-менеджменту. 📕",
        )
        if message.chat.type != "private":
            bot.send_message(message.chat.id, "Открой личный чат со мной и отправь /start.")
            return
        # Telegram supplies signed initData to Mini Apps launched from inline buttons.
        markup = types.InlineKeyboardMarkup()
        markup.add(types.InlineKeyboardButton(
            text=BUTTON_TEXT,
            web_app=types.WebAppInfo(url=web_app_url),
        ))
        bot.send_message(message.chat.id, "Нажми кнопку, чтобы открыть приложение.", reply_markup=markup)

    @bot.message_handler(content_types=["web_app_data"])
    def handle_webapp_data(message):
        bot.send_message(
            message.chat.id,
            "Данные из мини-приложения получены. Календарь доступен внутри приложения.",
        )

    return bot


def main():
    load_dotenv()
    token = os.environ.get("BOT_TOKEN", "").strip()
    web_app_url = os.environ.get("WEB_APP_URL", "").strip()
    url = urlsplit(web_app_url)
    if not token or url.scheme != "https" or not url.hostname:
        raise SystemExit("Укажите BOT_TOKEN и HTTPS-адрес WEB_APP_URL в .env.")
    print("Бот запущен.")
    create_bot(token, web_app_url).infinity_polling()


if __name__ == "__main__":
    main()
