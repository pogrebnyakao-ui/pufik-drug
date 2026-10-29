# Исходники иконки и заставки

Из этих картинок `@capacitor/assets` делает иконки и заставку Android
(подробно — в README.md в корне, раздел «Иконка и заставка»):

- `icon-only.png` — иконка целиком, 1024×1024
- `icon-foreground.png` — передний слой адаптивной иконки (прозрачный фон, персонаж в центральных 66 %), 1024×1024
- `icon-background.png` — задний слой адаптивной иконки (без прозрачности), 1024×1024
- `splash.png` — заставка, 2732×2732, Пуфик по центру на `#fff4c9`
- `splash-dark.png` — заставка для тёмной темы (такая же), 2732×2732

Пуфик нарисован функцией игры `drawPet()` из `game/pufik.html`: стадия «подрос» (`kid`), глаза открыты,
широкая улыбка. Фон иконки — радиальный градиент из цветов игры: `#fff6ea` → `#fff4c9` → `#ffd9a8`.

Генерация (из корня репозитория), потом закоммитить изменения в `android/app/src/main/res/`
и вернуть `AndroidManifest.xml` (команда переписывает его оформление):

```
npx @capacitor/assets@3.0.5 generate --android --iconBackgroundColor '#fff4c9' --iconBackgroundColorDark '#fff4c9' --splashBackgroundColor '#fff4c9' --splashBackgroundColorDark '#fff4c9'
git checkout -- android/app/src/main/AndroidManifest.xml
```

Иконка для карточки RuStore — `store/icon-512.png` (512×512, PNG, фон на всю площадь, без прозрачных краёв),
сделана из тех же картинок: RuStore проверяет, что она совпадает с иконкой на телефоне.
