"use client";

import { useState } from "react";

export default function HelpModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="signout-btn" onClick={() => setOpen(true)}>
        사용법
      </button>

      {open && (
        <div className="help-overlay" onClick={() => setOpen(false)}>
          <div className="help-panel" onClick={(e) => e.stopPropagation()}>
            <div className="help-header">
              <h2>사용법</h2>
              <button type="button" className="help-close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="help-body">
              <section>
                <h3>1. 두 가지 모드</h3>
                <p>
                  <strong>한 목소리로</strong>: 문단 하나, 목소리 하나. 가장 간단하고 빠릅니다.
                </p>
                <p>
                  <strong>여러 등장인물 (대본)</strong>: 나레이터 + 여러 캐릭터가 섞인 장면용.
                  등장인물이 몇 명이든 버튼 한 번에 파일 하나로 이어붙여 나와요.
                </p>
              </section>

              <section>
                <h3>2. 대본 쓰는 법</h3>
                <p>줄마다 "이름: 대사" 형식으로 씁니다.</p>
                <pre>{`나레이터: 밤안개가 골목 끝까지 자욱하게 내려앉았다.
지우: 누구야...? 거기 누구 있어?
나레이터: 그림자가 천천히 다가왔다.
민준: 나야, 놀라지 마.`}</pre>
                <p>
                  이름과 콜론 없이 그냥 쓴 줄은 전부 <strong>나레이션</strong>으로 처리돼요.
                  한 캐릭터의 대사가 여러 줄이면 그 줄마다 이름을 반복해서 적어주세요. 처음
                  보는 이름이 나오면 목소리를 자동으로 배정하고 출연진 목록에 추가해드려요 —
                  마음에 안 들면 그 목록에서 바로 바꾸고 다시 생성하면 됩니다.
                </p>
                <p>
                  소설이나 수필처럼 그냥 줄글로 써서 대본 형식이 아니어도 괜찮아요. 대본
                  입력창 아래 <strong>"✨ AI로 대사·나레이션 자동 구분"</strong> 버튼을 누르면
                  따옴표 안 대사를 찾아서 누가 말했는지 문맥으로 추론해 자동으로 "이름:"을
                  붙여줘요. 100% 정확하진 않으니 결과를 한 번 훑어보고 생성 전에 고쳐주세요.
                </p>
              </section>

              <section>
                <h3>3. 목소리 고르기</h3>
                <p>
                  <strong>핵심 30종</strong>: 모든 언어에서 쓸 수 있는 기본 목소리.
                </p>
                <p>
                  <strong>확장 라이브러리</strong>: 나이·직업·서울/부산 억양까지 설정된
                  한국어 전용 캐릭터 보이스.
                </p>
                <p>
                  <strong>내가 만든 목소리</strong>: 원하는 목소리를 문장으로 직접 설명해서
                  새로 만든 나만의 목소리 (아래 5번 참고).
                </p>
                <p>드롭다운에서 목소리 이름을 타이핑하면 브라우저가 바로 그 위치로 점프해줘요.</p>
              </section>

              <section>
                <h3>4. 감정 태그</h3>
                <p>
                  텍스트창 아래 버튼(한숨/웃음/헛기침/멈춤)을 누르면 커서 위치에{" "}
                  <code>&lt;sigh&gt;</code>, <code>&lt;laugh&gt;</code>,{" "}
                  <code>&lt;short pause&gt;</code> 같은 태그가 들어가요. 그 지점에서 실제로
                  한숨·웃음 등을 연기해줍니다.
                </p>
              </section>

              <section>
                <h3>5. 내 목소리 디자인하기</h3>
                <p>
                  기존 목소리 중에 마음에 드는 게 없으면, 원하는 목소리를 문장으로 설명해서
                  완전히 새로운 목소리를 만들 수 있어요. 예: "60대 후반의 다정한 할머니
                  목소리, 살짝 쉰 듯하고 느긋하게 말함". 한 번 만들면 계정에 영구 저장되어
                  다른 목소리처럼 계속 골라 쓸 수 있습니다.
                </p>
              </section>

              <section>
                <h3>6. 하루 사용 횟수</h3>
                <p>
                  Gemini는 하루에 요청 <strong>100회</strong>까지만 쓸 수 있어요. 글 아래에 "이 글은 Gemini
                  요청 약 N회가 필요해요"가 보이고, 남은 횟수보다 많으면 시작 전에 알려드려요. 등장인물이 여럿이면 두 목소리씩
                  묶어 한 번에 만든 뒤 줄마다 잘라 이어 붙여서, 등장인물이 많아도 요청이 적게 들어요. 자르는 위치가
                  애매한 줄은 추측하지 않고 그 줄만 다시 만들기 때문에 횟수가 조금 늘 수 있어요. 만든 부분은 이
                  브라우저에 저장돼서, 중간에 멈추거나 글을 조금 고쳐도 바뀐 부분만 다시 만들어요.
                </p>
                <p>
                  위쪽 <strong>사용량</strong> 버튼에서 오늘 남은 횟수와 최근 사용 기록을 볼 수 있어요. 횟수는
                  한국 시간 오후 4시쯤(겨울엔 5시) 새로 시작해요.
                </p>
              </section>

              <section>
                <h3>7. 보관함</h3>
                <p>
                  만든 음성은 위쪽 <strong>보관함</strong>에 모여요. 폴더를 만들어 정리하고, 카드를 폴더로 끌어다 놓을
                  수도 있어요. 폴더에 넣거나 ★ 표시한 음성은 자동으로 지워지지 않아요. 그 밖의 음성은 최근 50개까지만
                  남아요.
                </p>
              </section>

              <section>
                <h3>8. 추천 순서</h3>
                <p>
                  미리듣기로 목소리 후보를 짧게 들어보고 캐스팅을 확정한 다음, "여러
                  등장인물" 탭에 씬 전체를 쭉 붙여넣어 한 번에 긴 파일로 뽑으세요.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
