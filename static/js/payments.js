/* Расчёт платежей и формирование строки ST00012 (ГОСТ Р 56042-2014).
   Логика 1:1 с payments.py серверной версии. Подключается и в браузере, и в Node (тесты). */
(function (root) {
  "use strict";

  var CONFIG = {
    payee: {
      Name: 'НЕКОММЕРЧЕСКОЕ САДОВОДЧЕСКОЕ ТОВАРИЩЕСТВО "КОЛОС-1"',
      PersonalAcc: "40703810400130000655",
      BankName: 'АО КБ "ХЛЫНОВ", Г.КИРОВ',
      BIC: "043304711",
      CorrespAcc: "30101810100000000711",
      PayeeINN: "4346026874",
      KPP: "434501001"
    },
    feeRatePerM2Kop: 500,      // 5 ₽ за м² (500 ₽ за сотку)
    electricityRateKop: 505,   // 5,05 ₽ за кВт·ч
    maxAmountRub: 10000000
  };

  function PaymentError(message) { this.message = message; }
  PaymentError.prototype = Object.create(Error.prototype);

  function fmtRub(kop) {
    var rub = Math.floor(kop / 100), k = kop % 100;
    return k === 0 ? String(rub) : rub + "." + (k < 10 ? "0" : "") + k;
  }

  function intField(value, name) {
    if (value === null || value === undefined || String(value).trim() === "")
      throw new PaymentError("Введите " + name);
    var f = Number(String(value).replace(",", "."));
    if (!isFinite(f)) throw new PaymentError("Введите " + name);
    if (f !== Math.floor(f) || f < 0)
      throw new PaymentError(name.charAt(0).toUpperCase() + name.slice(1) + " — целое неотрицательное число");
    return f;
  }

  function checkAmount(kop) {
    if (kop <= 0) throw new PaymentError("Сумма к оплате должна быть больше нуля");
    if (kop > CONFIG.maxAmountRub * 100) throw new PaymentError("Слишком большая сумма, проверьте введённые данные");
  }

  function payload(purpose, kop) {
    var p = CONFIG.payee;
    return "ST00012|" +
      "Name=" + p.Name + "|" +
      "PersonalAcc=" + p.PersonalAcc + "|" +
      "BankName=" + p.BankName + "|" +
      "BIC=" + p.BIC + "|" +
      "CorrespAcc=" + p.CorrespAcc + "|" +
      "PayeeINN=" + p.PayeeINN + "|" +
      "KPP=" + p.KPP + "|" +
      "Purpose=" + purpose + "|" +
      "Sum=" + kop;
  }

  /* plot — объект из PLOTS; возвращает {lines, payload} или бросает PaymentError */
  function buildPayment(kind, plot, opts) {
    opts = opts || {};
    if (!plot) throw new PaymentError("Участок не найден");
    var n = plot.number, head = "Участок № " + n, kop;

    if (kind === "fee") {
      kop = plot.area * CONFIG.feeRatePerM2Kop;
      checkAmount(kop);
      return { lines: [head, "Сумма к оплате - " + fmtRub(kop) + " ₽"],
               payload: payload("ЧЛЕНСКИЙ ВЗНОС, УЧАСТОК №" + n, kop) };
    }
    if (kind === "electricity") {
      var a = intField(opts.t1, "предыдущие показания");
      var b = intField(opts.t2, "текущие показания");
      if (b < a) throw new PaymentError("Корректно введите показания: текущие меньше предыдущих");
      var consumption = b - a;
      kop = consumption * CONFIG.electricityRateKop;
      checkAmount(kop);
      return { lines: [head, "Потребление, кВт - " + consumption, "Сумма к оплате - " + fmtRub(kop) + " ₽"],
               payload: payload("ЭЛЕКТРОЭНЕРГИЯ, УЧАСТОК №" + n + ", Т1=" + a + ", Т2=" + b, kop) };
    }
    if (kind === "arrears") {
      var rub = intField(opts.amount, "сумму");
      kop = rub * 100;
      checkAmount(kop);
      return { lines: [head, "Сумма к оплате - " + rub + " ₽"],
               payload: payload("ПРОШЛЫЕ ПЕРИОДЫ, УЧАСТОК №" + n, kop) };
    }
    throw new PaymentError("Неизвестный тип платежа");
  }

  function plotInfoLines(p) {
    return [
      "Участок № " + p.number,
      "Информация из Росреестра:",
      "Кадастровый номер - " + p.cadastral,
      "Кадастровая стоимость - " + p.cadastral_cost.toFixed(2) + " ₽",
      "Дата внесения сведений о кадастровой стоимости в ГКН - " + p.cost_date,
      "Адрес - " + p.address,
      "Тип использования - " + p.use,
      "Площадь - " + p.area + " м²"
    ];
  }

  var api = { CONFIG: CONFIG, PaymentError: PaymentError, buildPayment: buildPayment,
              plotInfoLines: plotInfoLines, fmtRub: fmtRub };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Payments = api;
})(typeof window !== "undefined" ? window : globalThis);
