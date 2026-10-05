/** Riverside's DOM skin is scoped so saved and generated regions retain their interface. */
export const RIVERSIDE_INTERFACE_CLASS = 'riverside-interface';

export const RIVERSIDE_INTERFACE_STYLES = `
body.riverside-interface [data-testid="company-hud"]{
  left:78px!important;right:18px!important;top:14px!important;width:auto!important;
  gap:14px!important;padding:10px 16px!important;border:1px solid #c9c4b1!important;
  border-radius:12px!important;background:#f5f0e3f5!important;color:#34584c!important;
  font:12px/1.4 system-ui,sans-serif!important;box-shadow:0 5px 20px #243b2a24;
}
body.riverside-interface [data-testid="company-hud"]::before{
  content:attr(data-riverside-company-name);margin-right:auto;color:#214b42;
  font:600 21px/1.25 Georgia,serif;letter-spacing:-.4px;
}
body.riverside-interface [data-testid="company-cash"]{color:#214b42!important;font-size:18px!important;white-space:nowrap}
body.riverside-interface [data-testid="company-save-state"]{color:#665e47!important;font-size:11px;padding:4px 8px;border:1px solid #d5cbb3;border-radius:20px;white-space:nowrap}
body.riverside-interface [data-testid="company-hud"][data-save-state="unsaved"] [data-testid="company-save-state"]{background:#e9dbb7;color:#6b5127!important}
body.riverside-interface [data-testid="company-economy-time"]{color:#6b7563!important}
body.riverside-interface [data-testid="company-operating-profit"]{color:#34584c!important;font-size:11px}
body.riverside-interface [data-testid="company-operating-profit"][data-tone="loss"]{color:#9a5141!important}
body.riverside-interface [data-testid="company-cash-pulse"]{color:#326b48!important}
body.riverside-interface [data-testid="company-hud"] :is([data-testid="company-construction-index"],[data-testid="company-operating-period"],[data-testid="company-delivery-revenue"],[data-testid="company-contract-bonuses"],[data-testid="company-running-expenses"],[data-testid="company-capital-expenditure"],[data-testid="company-cash-flow"],[data-testid="company-last-delivery"]){display:none!important}
.railway-panel.rp-riverside{right:18px;width:350px;max-width:calc(100vw - 36px);color:#284b40;font:13px/1.5 system-ui,sans-serif}
.railway-panel.rp-riverside button,.railway-panel.rp-riverside input,.railway-panel.rp-riverside select{border-color:#c9c9b7;background:#faf7ec;color:#315247;border-radius:7px}
.railway-panel.rp-riverside button:hover{background:#e7e9d9;border-color:#81977e}
.railway-panel.rp-riverside button:focus-visible,.railway-panel.rp-riverside input:focus-visible,.railway-panel.rp-riverside select:focus-visible{outline-color:#b59851}
.railway-panel.rp-riverside .rp-head{gap:4px;padding:7px;background:#f5f0e3f5;border:1px solid #c9c4b1;border-radius:10px;box-shadow:0 5px 18px #243b2a22}
.railway-panel.rp-riverside .rp-head button{padding:6px;flex-shrink:0;font-size:12px}
.railway-panel.rp-riverside .rp-head .rp-toggle{font-weight:650;padding:6px 8px}
.railway-panel.rp-riverside .rp-head span{font-size:10px;color:#6b7563;text-align:center}
.railway-panel.rp-riverside .rp-head button[data-speed]{min-width:44px}
.railway-panel.rp-riverside .rp-head button[aria-pressed="true"]{background:#265e58;border-color:#265e58;color:#fff9e9;box-shadow:inset 0 0 0 1px #ffffff16}
.railway-panel.rp-riverside .rp-head button.rp-start{background:#265e58;border-color:#265e58;color:#fff9e9;font-weight:650}
.railway-panel.rp-riverside .rp-body{padding:14px;background:#f5f0e3f7;border:1px solid #c9c4b1;box-shadow:0 8px 24px #243b2a28}
.railway-panel.rp-riverside nav{display:grid;grid-template-columns:repeat(4,1fr);gap:3px;border-bottom:1px solid #d6d1bf;padding-bottom:10px;margin-bottom:14px;overflow:visible}
.railway-panel.rp-riverside nav button{font-size:11px;padding:5px 3px;min-width:0;background:transparent;border-color:transparent}
.railway-panel.rp-riverside nav button[aria-selected="true"]{background:#265e58;color:#fff9e9;border-color:#265e58}
.railway-panel.rp-riverside h2{font:600 24px/1.2 Georgia,serif;letter-spacing:-.4px;margin:4px 0 8px;color:#214b42}
.railway-panel.rp-riverside h3{font-size:15px;color:#214b42}
.railway-panel.rp-riverside p{margin:6px 0 10px}
.railway-panel.rp-riverside .rp-muted{color:#73806a;font-size:11px}
.railway-panel.rp-riverside .rp-card{background:#faf7ee;border-color:#d1d1bb;border-radius:9px;padding:12px}
.railway-panel.rp-riverside .rp-primary{background:#265e58;color:#fff9e9;border-color:#265e58;font-weight:650}
.railway-panel.rp-riverside .rp-primary:hover{background:#194c45;border-color:#194c45}
.railway-panel.rp-riverside .rp-status{color:#78522c;border-color:#d1d1bb;font-size:12px}
.railway-panel.rp-riverside .rp-status:empty{display:none}
.railway-panel.rp-riverside progress{height:6px;accent-color:#447c62}
.railway-panel.rp-riverside .rp-eyebrow{margin:0 0 7px;text-transform:uppercase;letter-spacing:1.7px;font-size:9px;font-weight:700;color:#6b7a5b}
.railway-panel.rp-riverside .rp-objective{background:#e8ebd8;border:1px solid #c9d0b4;border-radius:9px;padding:13px;margin-bottom:15px}
.railway-panel.rp-riverside .rp-objective h2{font-size:23px}
.railway-panel.rp-riverside .rp-objective p{font-size:12px}
.railway-panel.rp-riverside .rp-objective .rp-goals{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
.railway-panel.rp-riverside .rp-goal{font-size:10px;color:#627359}
.railway-panel.rp-riverside .rp-goal strong{display:block;font-size:19px;font-weight:650;color:#265e58}
.railway-panel.rp-riverside .rp-goal progress{display:block;margin-top:5px}
.railway-panel.rp-riverside .rp-objective .rp-primary{width:100%}
.railway-panel.rp-riverside .rp-service-heading{display:flex;justify-content:space-between;align-items:center;gap:8px}
.railway-panel.rp-riverside .rp-service-heading h3{margin:0}
.railway-panel.rp-riverside .rp-service-kind{color:#688063;font-size:9px;letter-spacing:1px;text-transform:uppercase}
.railway-panel.rp-riverside .rp-service-route{font-size:11px;color:#67765e;margin:7px 0}
.railway-panel.rp-riverside .rp-service-state{font-size:12px;margin:6px 0}
.railway-panel.rp-riverside .rp-service-tools button{font-size:11px;min-height:44px}
.railway-panel.rp-riverside details{border-top:1px solid #d6d1bf;padding:10px 0}
.railway-panel.rp-riverside summary{cursor:pointer;font-size:12px;font-weight:600}
@media(max-width:1100px){.railway-panel.rp-riverside{width:330px}}
@media(max-width:720px){
 body.riverside-interface [data-testid="company-hud"]{left:58px!important;right:10px!important;top:10px!important;gap:8px!important;padding:9px 11px!important}
 body.riverside-interface [data-testid="company-hud"]::before{font-size:17px}
 body.riverside-interface [data-testid="company-cash"]{font-size:16px!important}
 body.riverside-interface [data-testid="company-economy-time"],body.riverside-interface [data-testid="company-operating-profit"]{display:none!important}
 .railway-panel.rp-riverside{right:10px;max-width:calc(100vw - 20px)}
 .railway-panel.rp-riverside .rp-head span{display:none}
 .railway-panel.rp-riverside .rp-head .rp-toggle{flex:1}
}
`;
