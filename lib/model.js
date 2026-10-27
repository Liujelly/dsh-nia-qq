// DSH NEXT exposes options/requestHeader and a modelSelection projection, not agent.model.
export function agentModel(ctx, agent) {
  const valid = value => value && typeof value.provider === 'string' && value.provider && typeof value.model === 'string' && value.model
    ? { provider: value.provider, model: value.model } : null;
  const projections=ctx.get?.('sessionProjections')??ctx.sessionProjections;
  let selected;
  try{selected=valid(projections?.stateOf(agent.session,'modelSelection')?.pending);}catch{}
  if(selected)return selected;
  const logged=valid(agent.session?.requestHeader?.()?.config);
  if(logged)return logged;
  const configured=valid(agent.options);
  if(configured)return configured;
  // Compatibility only; the current host does not implement this member.
  const legacy=valid(agent.model?.current?.());
  if(legacy)return legacy;
  return valid((ctx.get?.('agentDefaultModel')??ctx.agentDefaultModel)?.currentSelection?.());
}
