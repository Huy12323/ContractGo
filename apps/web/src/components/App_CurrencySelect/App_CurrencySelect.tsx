import { useMemo } from 'react'
import { Select } from 'antd'
import { useQ_Tables_Currencies } from '@/hooks/useQ_Tables_Currencies'

interface App_CurrencySelectProps {
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  placeholder?: string
  style?: React.CSSProperties
}

export const App_CurrencySelect = ({
  value,
  onChange,
  disabled,
  placeholder = 'Select currency',
  style,
}: App_CurrencySelectProps) => {
  const qCurrencies = useQ_Tables_Currencies()

  const options = useMemo(
    () => qCurrencies.currencies.map((c) => ({ value: c.code, label: `${c.display_name} (${c.code})` })),
    [qCurrencies.currencies],
  )

  return (
    <Select
      showSearch
      optionFilterProp="label"
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      loading={qCurrencies.query.isLoading}
      options={options}
      style={style}
    />
  )
}
